import { initTRPC } from "@trpc/server";
import { z } from "zod";
import {
    GetModelRequestSchema,
    RestartModelRequestSchema,
    ServeModelRequestSchema,
    StopModelRequestSchema,
    TransitionModelCommandSchema,
} from "./inference-domain.ts";
import { parseModelStopSignal } from "./llm-service.ts";
import type { InferenceSupervisorService } from "./inference-supervisor-service.ts";

export type InferenceServiceContext = {
    inferenceService: InferenceSupervisorService;
};

const t = initTRPC.context<InferenceServiceContext>().create();

export const inferenceServiceRouter = t.router({
    health: t.procedure.query(async ({ ctx }) => await ctx.inferenceService.health()),
    listModels: t.procedure.query(async ({ ctx }) => await ctx.inferenceService.listModels()),
    getModel: t.procedure
        .input(GetModelRequestSchema)
        .query(async ({ ctx, input }) => await ctx.inferenceService.getModel(input.targetId)),
    serveModel: t.procedure
        .input(ServeModelRequestSchema)
        .mutation(async ({ ctx, input }) => await ctx.inferenceService.serveModel(input.config)),
    stopModel: t.procedure
        .input(StopModelRequestSchema)
        .mutation(async ({ ctx, input }) =>
            await ctx.inferenceService.stopModel(
                input.targetId,
                parseModelStopSignal(input.signal),
            ),
        ),
    restartModel: t.procedure
        .input(RestartModelRequestSchema)
        .mutation(async ({ ctx, input }) => await ctx.inferenceService.restartModel(input.targetId)),
    transitionModel: t.procedure
        .input(TransitionModelCommandSchema)
        .mutation(async ({ ctx, input }) => await ctx.inferenceService.applyTransition(input)),
    listProcesses: t.procedure
        .query(async ({ ctx }) => await ctx.inferenceService.listProcesses()),
    reconcileProcesses: t.procedure
        .input(z.object({ desiredCount: z.number().int().min(0) }))
        .mutation(async ({ ctx, input }) =>
            await ctx.inferenceService.reconcileProcesses(input.desiredCount),
        ),
});

export type InferenceServiceRouter = typeof inferenceServiceRouter;
