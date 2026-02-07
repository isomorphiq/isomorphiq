import type { ContextClient } from "@isomorphiq/context";
import type { WorkflowToken } from "../workflow-engine.ts";
import type { WorkflowContextToken } from "./types.ts";
import { normalizeContextData } from "./shared/basic-utils.ts";

export type NoTaskWaitLogState = {
    noTaskWaitLogKey: string | null;
    noTaskWaitLogRepeats: number;
    noTaskWaitLogLastAtMs: number;
};

export const createNoTaskWaitLogState = (): NoTaskWaitLogState => ({
    noTaskWaitLogKey: null,
    noTaskWaitLogRepeats: 0,
    noTaskWaitLogLastAtMs: 0,
});

export const resetNoTaskWaitLogging = (state: NoTaskWaitLogState): NoTaskWaitLogState => ({
    ...state,
    noTaskWaitLogKey: null,
    noTaskWaitLogRepeats: 0,
    noTaskWaitLogLastAtMs: 0,
});

export const logNoTaskWait = (
    state: NoTaskWaitLogState,
    transition: string,
    targetType: string | undefined,
    heartbeatMs: number,
): NoTaskWaitLogState => {
    const now = Date.now();
    const resolvedTargetType = targetType ?? "matching";
    const key = `${transition}:${resolvedTargetType}`;

    if (state.noTaskWaitLogKey !== key) {
        console.log(`[WORKFLOW] No ${resolvedTargetType} tasks for ${transition}; waiting.`);
        return {
            noTaskWaitLogKey: key,
            noTaskWaitLogRepeats: 0,
            noTaskWaitLogLastAtMs: now,
        };
    }

    const repeats = state.noTaskWaitLogRepeats + 1;
    if (
        state.noTaskWaitLogLastAtMs > 0
        && now - state.noTaskWaitLogLastAtMs >= heartbeatMs
    ) {
        console.log(
            `[WORKFLOW] Still waiting for ${resolvedTargetType} tasks for ${transition} (retries=${repeats}).`,
        );
        return {
            ...state,
            noTaskWaitLogRepeats: 0,
            noTaskWaitLogLastAtMs: now,
        };
    }

    return {
        ...state,
        noTaskWaitLogRepeats: repeats,
    };
};

export const ensureContextId = async (
    token: WorkflowToken<WorkflowContextToken>,
    contextClient: ContextClient,
): Promise<{ token: WorkflowToken<WorkflowContextToken>; contextId: string }> => {
    const existingId =
        token.context && typeof token.context.contextId === "string"
            ? token.context.contextId
            : undefined;
    if (existingId) {
        return { token, contextId: existingId };
    }

    const created = await contextClient.createContext();
    const contextId = created.id;
    return {
        token: { ...token, context: { contextId } },
        contextId,
    };
};

export const loadContextData = async (
    contextClient: ContextClient,
    contextId: string,
): Promise<Record<string, unknown>> => {
    const existing = await contextClient.getContext(contextId);
    if (existing) {
        return normalizeContextData(existing.data);
    }
    const created = await contextClient.createContext({ id: contextId, data: {} });
    return normalizeContextData(created.data);
};

export const updateContextData = async (
    contextClient: ContextClient,
    contextId: string,
    patch: Record<string, unknown>,
): Promise<void> => {
    if (Object.keys(patch).length === 0) {
        return;
    }
    await contextClient.updateContext(contextId, patch);
};
