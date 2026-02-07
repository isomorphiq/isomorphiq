import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import type { Result } from "@isomorphiq/core";
import { NotFoundError } from "@isomorphiq/core";
import type { EnhancedTaskService } from "./enhanced-task-service.ts";
import { TaskSearchOptionsSchema } from "./types.ts";
import {
    CreateTaskInputWithPrioritySchema,
    ExtendedUpdateTaskInputSchema,
} from "./task-domain.ts";
import type { TaskEntity } from "./task-domain.ts";
import { TaskPrioritySchema, TaskStatusSchema } from "./types.ts";
import type { TaskEvent } from "./task-events.ts";
import { TaskEventBus } from "./task-event-bus.ts";

export type TaskServiceContext = {
    environment: string;
    taskService: EnhancedTaskService;
    taskEventBus: TaskEventBus;
};

const t = initTRPC.context<TaskServiceContext>().create();

const resolveResult = <T>(result: Result<T>): T => {
    if (!result.success) {
        throw result.error;
    }
    return result.data;
};

const resolveTaskOrNull = async (
    taskService: EnhancedTaskService,
    id: string,
): Promise<TaskEntity | null> => {
    const result = await taskService.getTask(id);
    if (!result.success) {
        if (result.error instanceof NotFoundError) {
            return null;
        }
        throw result.error;
    }
    return result.data;
};

const emitTaskEvent = (
    ctx: TaskServiceContext,
    event: Omit<TaskEvent, "environment" | "timestamp">,
): void => {
    ctx.taskEventBus.emit({
        ...event,
        environment: ctx.environment,
        timestamp: new Date().toISOString(),
    });
};

export const taskServiceRouter = t.router({
    list: t.procedure.query(async ({ ctx }) => {
        const result = await ctx.taskService.getAllTasks();
        return resolveResult(result);
    }),
    get: t.procedure
        .input(z.object({ id: z.string() }))
        .query(async ({ ctx, input }) => {
            const task = await resolveTaskOrNull(ctx.taskService, input.id);
            return task;
        }),
    search: t.procedure
        .input(TaskSearchOptionsSchema)
        .query(async ({ ctx, input }) => {
            const result = await ctx.taskService.searchTasks(input);
            return resolveResult(result);
        }),
    create: t.procedure
        .input(
            z.object({
                input: CreateTaskInputWithPrioritySchema,
                createdBy: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.taskService.createTask(input.input, input.createdBy ?? "system");
            const task = resolveResult(result);
            emitTaskEvent(ctx, {
                type: "task_created",
                task,
                updatedBy: input.createdBy ?? "system",
            });
            return task;
        }),
    update: t.procedure
        .input(
            z.object({
                id: z.string(),
                updates: ExtendedUpdateTaskInputSchema.omit({ id: true }),
                updatedBy: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const previous = await resolveTaskOrNull(ctx.taskService, input.id);
            const result = await ctx.taskService.updateTask(
                input.id,
                { id: input.id, ...input.updates },
                input.updatedBy ?? "system",
            );
            const task = resolveResult(result);
            emitTaskEvent(ctx, {
                type: "task_updated",
                task,
                updatedBy: input.updatedBy ?? "system",
            });

            if (input.updates.status && previous) {
                emitTaskEvent(ctx, {
                    type: "task_status_changed",
                    task,
                    taskId: task.id,
                    oldStatus: previous.status,
                    newStatus: input.updates.status,
                    updatedBy: input.updatedBy ?? "system",
                });
            }

            if (input.updates.priority && previous) {
                emitTaskEvent(ctx, {
                    type: "task_priority_changed",
                    task,
                    taskId: task.id,
                    oldPriority: previous.priority,
                    newPriority: input.updates.priority,
                    updatedBy: input.updatedBy ?? "system",
                });
            }

            if (input.updates.assignedTo) {
                emitTaskEvent(ctx, {
                    type: "task_assigned",
                    task,
                    taskId: task.id,
                    updatedBy: input.updatedBy ?? "system",
                });
            }

            if (input.updates.collaborators) {
                emitTaskEvent(ctx, {
                    type: "task_collaborators_changed",
                    task,
                    taskId: task.id,
                    updatedBy: input.updatedBy ?? "system",
                });
            }

            if (input.updates.dependencies) {
                emitTaskEvent(ctx, {
                    type: "task_dependencies_changed",
                    task,
                    taskId: task.id,
                    updatedBy: input.updatedBy ?? "system",
                });
            }

            return task;
        }),
    delete: t.procedure
        .input(z.object({ id: z.string(), deletedBy: z.string().optional() }))
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.taskService.deleteTask(input.id, input.deletedBy ?? "system");
            resolveResult(result);
            emitTaskEvent(ctx, {
                type: "task_deleted",
                taskId: input.id,
                updatedBy: input.deletedBy ?? "system",
            });
            return { success: true };
        }),
    updateStatus: t.procedure
        .input(z.object({ id: z.string(), status: TaskStatusSchema, updatedBy: z.string().optional() }))
        .mutation(async ({ ctx, input }) => {
            const previous = await resolveTaskOrNull(ctx.taskService, input.id);
            const result = await ctx.taskService.updateTaskStatus(
                input.id,
                input.status,
                input.updatedBy ?? "system",
            );
            const task = resolveResult(result);
            emitTaskEvent(ctx, {
                type: "task_status_changed",
                task,
                taskId: task.id,
                oldStatus: previous?.status,
                newStatus: input.status,
                updatedBy: input.updatedBy ?? "system",
            });
            return task;
        }),
    claimTask: t.procedure
        .input(
            z.object({
                id: z.string(),
                workerId: z.string().min(1),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.taskService.claimTaskForWorker(input.id, input.workerId);
            if (!result.success) {
                throw result.error;
            }
            const claimedTask = result.data;
            if (!claimedTask) {
                return null;
            }
            emitTaskEvent(ctx, {
                type: "task_status_changed",
                task: claimedTask,
                taskId: claimedTask.id,
                oldStatus: "todo",
                newStatus: "in-progress",
                updatedBy: input.workerId,
            });
            return claimedTask;
        }),
    updatePriority: t.procedure
        .input(
            z.object({ id: z.string(), priority: TaskPrioritySchema, updatedBy: z.string().optional() }),
        )
        .mutation(async ({ ctx, input }) => {
            const previous = await resolveTaskOrNull(ctx.taskService, input.id);
            const result = await ctx.taskService.updateTaskPriority(
                input.id,
                input.priority,
                input.updatedBy ?? "system",
            );
            const task = resolveResult(result);
            emitTaskEvent(ctx, {
                type: "task_priority_changed",
                task,
                taskId: task.id,
                oldPriority: previous?.priority,
                newPriority: input.priority,
                updatedBy: input.updatedBy ?? "system",
            });
            return task;
        }),
    assign: t.procedure
        .input(
            z.object({
                id: z.string(),
                assignedTo: z.string(),
                assignedBy: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.taskService.assignTask(
                input.id,
                input.assignedTo,
                input.assignedBy ?? "system",
            );
            const task = resolveResult(result);
            emitTaskEvent(ctx, {
                type: "task_assigned",
                task,
                taskId: task.id,
                updatedBy: input.assignedBy ?? "system",
            });
            return task;
        }),
    addCollaborator: t.procedure
        .input(
            z.object({
                id: z.string(),
                userId: z.string(),
                updatedBy: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.taskService.addCollaborator(
                input.id,
                input.userId,
                input.updatedBy ?? "system",
            );
            const task = resolveResult(result);
            emitTaskEvent(ctx, {
                type: "task_collaborators_changed",
                task,
                taskId: task.id,
                updatedBy: input.updatedBy ?? "system",
            });
            return task;
        }),
    removeCollaborator: t.procedure
        .input(
            z.object({
                id: z.string(),
                userId: z.string(),
                updatedBy: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.taskService.removeCollaborator(
                input.id,
                input.userId,
                input.updatedBy ?? "system",
            );
            const task = resolveResult(result);
            emitTaskEvent(ctx, {
                type: "task_collaborators_changed",
                task,
                taskId: task.id,
                updatedBy: input.updatedBy ?? "system",
            });
            return task;
        }),
    addDependency: t.procedure
        .input(
            z.object({
                id: z.string(),
                dependsOn: z.string(),
                updatedBy: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.taskService.addDependency(
                input.id,
                input.dependsOn,
                input.updatedBy ?? "system",
            );
            const task = resolveResult(result);
            emitTaskEvent(ctx, {
                type: "task_dependencies_changed",
                task,
                taskId: task.id,
                updatedBy: input.updatedBy ?? "system",
            });
            return task;
        }),
    addWatcher: t.procedure
        .input(
            z.object({
                id: z.string(),
                userId: z.string(),
                updatedBy: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.taskService.addWatcher(
                input.id,
                input.userId,
                input.updatedBy ?? "system",
            );
            const task = resolveResult(result);
            emitTaskEvent(ctx, {
                type: "task_watchers_changed",
                task,
                taskId: task.id,
                updatedBy: input.updatedBy ?? "system",
            });
            return task;
        }),
    removeWatcher: t.procedure
        .input(
            z.object({
                id: z.string(),
                userId: z.string(),
                updatedBy: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.taskService.removeWatcher(
                input.id,
                input.userId,
                input.updatedBy ?? "system",
            );
            const task = resolveResult(result);
            emitTaskEvent(ctx, {
                type: "task_watchers_changed",
                task,
                taskId: task.id,
                updatedBy: input.updatedBy ?? "system",
            });
            return task;
        }),
    removeDependency: t.procedure
        .input(
            z.object({
                id: z.string(),
                dependsOn: z.string(),
                updatedBy: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.taskService.removeDependency(
                input.id,
                input.dependsOn,
                input.updatedBy ?? "system",
            );
            const task = resolveResult(result);
            emitTaskEvent(ctx, {
                type: "task_dependencies_changed",
                task,
                taskId: task.id,
                updatedBy: input.updatedBy ?? "system",
            });
            return task;
        }),
    getByStatus: t.procedure
        .input(z.object({ status: TaskStatusSchema }))
        .query(async ({ ctx, input }) => {
            const result = await ctx.taskService.getTasksByStatus(input.status);
            return resolveResult(result);
        }),
    getByUser: t.procedure
        .input(z.object({ userId: z.string() }))
        .query(async ({ ctx, input }) => {
            const result = await ctx.taskService.getTasksByUser(input.userId);
            return resolveResult(result);
        }),
    sortedByDependencies: t.procedure.query(async ({ ctx }) => {
        const result = await ctx.taskService.getTasksSortedByDependencies();
        return resolveResult(result);
    }),
    createMany: t.procedure
        .input(
            z.object({
                inputs: z.array(CreateTaskInputWithPrioritySchema),
                createdBy: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const result = await ctx.taskService.createManyTasks(
                input.inputs,
                input.createdBy ?? "system",
            );
            const tasks = resolveResult(result);
            tasks.forEach((task) => {
                emitTaskEvent(ctx, {
                    type: "task_created",
                    task,
                    updatedBy: input.createdBy ?? "system",
                });
            });
            return tasks;
        }),
    taskEvents: t.procedure.subscription(({ ctx }) => {
        return observable<TaskEvent>((emit) => {
            const unsubscribe = ctx.taskEventBus.subscribe((event) => emit.next(event));
            return () => unsubscribe();
        });
    }),
});

export type TaskServiceRouter = typeof taskServiceRouter;
