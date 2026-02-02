// TODO: This file is too complex (991 lines) and should be refactored into several modules.
// Current concerns mixed: React components for CLI UI, session state management, input handling,
// real-time updates, workflow visualization, task display components.
// 
// Proposed structure:
// - cli-ui/components/ - Individual React components
//   - session-view.tsx, task-list.tsx, workflow-view.tsx, status-bar.tsx
// - cli-ui/hooks/ - Custom React hooks
//   - use-session.ts, use-input-handler.ts, use-updates.ts
// - cli-ui/state/ - State management
//   - session-store.ts, update-reducer.ts
// - cli-ui/renderers/ - Output rendering utilities
// - cli-ui/types.ts - UI-specific types
// - cli-ui/index.ts - Main UI composition

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useInput, useStdout, useStdin } from "ink";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

type SessionUpdatePayload = Record<string, unknown> & {
    sessionUpdate?: string;
    content?: { type?: string; text?: string };
    update?: { sessionUpdate?: string; content?: { type?: string; text?: string } };
    updates?: { sessionUpdate?: string; content?: { type?: string; text?: string } };
    sessionId?: string;
    profileName?: string;
    runtimeName?: string;
    modelName?: string;
    requestedModelName?: string;
    mcpTools?: string[];
    timestamp?: string;
    taskId?: string;
    taskTitle?: string;
    taskType?: string;
    taskStatus?: string;
    workflowState?: string;
    workflowSourceState?: string;
    workflowTargetState?: string;
    workflowTransition?: string;
    isDecider?: boolean;
};

type TurnState = {
    id: number;
    thought: string;
    message: string;
    updatedAt: string;
    isProcessing: boolean;
    sessionId?: string;
    profileName?: string;
    runtimeName?: string;
    modelName?: string;
    requestedModelName?: string;
    mcpTools?: string[];
    taskType?: string;
    taskId?: string;
    taskTitle?: string;
    workflowState?: string;
    workflowSourceState?: string;
    workflowTargetState?: string;
    workflowTransition?: string;
    isDecider?: boolean;
};

type UiState = {
    turns: TurnState[];
    currentTurnId: number;
    activeTurnId: number;
    turnBySessionId: Record<string, number>;
    systemMessages: Array<{
        id: number;
        text: string;
        timestamp: string;
    }>;
};

type FocusTarget = "system" | "thought" | "message" | "prev" | "next";

type CliConfig = {
    streamPath?: string;
    logPaths: string[];
};

const parseCliConfig = (args: string[]): CliConfig => {
    const readValue = (key: string): string | undefined => {
        const entry = args.find((arg) => arg.startsWith(`${key}=`));
        if (entry) {
            return entry.slice(key.length + 1);
        }
        const index = args.indexOf(key);
        if (index >= 0 && index + 1 < args.length) {
            return args[index + 1];
        }
        return undefined;
    };

    const streamPath = readValue("--stream-path");
    const logPathsValue = readValue("--log-paths") ?? "";
    const logPaths = logPathsValue
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

    return { streamPath, logPaths };
};

const CLI_CONFIG = parseCliConfig(process.argv.slice(2));

const createTurn = (id: number): TurnState => ({
    id,
    thought: "",
    message: "",
    updatedAt: new Date().toISOString(),
    isProcessing: true,
});

const formatTimestamp = (value: string | undefined): string => {
    if (!value) {
        return new Date().toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const clampTurns = (turns: TurnState[], maxTurns: number): TurnState[] =>
    turns.length > maxTurns ? turns.slice(turns.length - maxTurns) : turns;

const clampSystem = (
    messages: Array<{ id: number; text: string; timestamp: string }>,
    maxMessages: number,
): Array<{ id: number; text: string; timestamp: string }> =>
    messages.length > maxMessages ? messages.slice(messages.length - maxMessages) : messages;

const navigateTurn = (state: UiState, isPrevTurn: boolean): UiState => {
    const orderedTurns = [...state.turns].sort((a, b) => a.id - b.id);
    if (orderedTurns.length === 0) {
        return state;
    }
    const currentIndex = orderedTurns.findIndex(
        (turn) => turn.id === state.activeTurnId,
    );
    const safeIndex = currentIndex >= 0 ? currentIndex : orderedTurns.length - 1;
    const nextIndex = isPrevTurn ? safeIndex - 1 : safeIndex + 1;
    if (nextIndex < 0 || nextIndex >= orderedTurns.length) {
        return state;
    }
    return {
        ...state,
        activeTurnId: orderedTurns[nextIndex].id,
    };
};

const normalizeActiveTurnId = (state: UiState): UiState => {
    if (state.turns.length === 0) {
        return state;
    }
    if (state.turns.some((turn) => turn.id === state.activeTurnId)) {
        return state;
    }
    const sorted = [...state.turns].sort((a, b) => a.id - b.id);
    const minId = sorted[0].id;
    const maxId = sorted[sorted.length - 1].id;
    const nextActiveId = state.activeTurnId < minId ? minId : maxId;
    return {
        ...state,
        activeTurnId: nextActiveId,
    };
};

const readUpdateType = (payload: SessionUpdatePayload): string | null =>
    payload.sessionUpdate ??
    payload.update?.sessionUpdate ??
    payload.updates?.sessionUpdate ??
    null;

const readContentText = (payload: SessionUpdatePayload): string => {
    const content =
        payload.content ??
        payload.update?.content ??
        payload.updates?.content ??
        {};
    return typeof content?.text === "string" ? content.text : "";
};

const readSessionId = (payload: SessionUpdatePayload): string | null => {
    const candidate =
        payload.sessionId ??
        (payload.update as { sessionId?: unknown } | undefined)?.sessionId ??
        (payload.updates as { sessionId?: unknown } | undefined)?.sessionId;
    if (typeof candidate !== "string") {
        return null;
    }
    const trimmed = candidate.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const WORKFLOW_TRANSITIONS: Array<{
    source: string;
    target: string;
    label: string;
}> = [
    { source: "themes-proposed", target: "themes-proposed", label: "retry-theme-research" },
    { source: "themes-proposed", target: "themes-prioritized", label: "prioritize-themes" },
    { source: "themes-prioritized", target: "themes-proposed", label: "request-theme" },
    { source: "themes-prioritized", target: "initiatives-proposed", label: "define-initiatives" },
    { source: "themes-prioritized", target: "initiatives-prioritized", label: "prioritize-initiatives" },
    { source: "initiatives-proposed", target: "initiatives-proposed", label: "retry-initiative-research" },
    { source: "initiatives-proposed", target: "initiatives-prioritized", label: "prioritize-initiatives" },
    { source: "initiatives-proposed", target: "themes-proposed", label: "request-theme" },
    { source: "initiatives-prioritized", target: "initiatives-proposed", label: "define-initiatives" },
    { source: "initiatives-prioritized", target: "new-feature-proposed", label: "research-new-features" },
    { source: "initiatives-prioritized", target: "features-prioritized", label: "prioritize-features" },
    { source: "new-feature-proposed", target: "new-feature-proposed", label: "retry-product-research" },
    { source: "new-feature-proposed", target: "initiatives-proposed", label: "define-initiatives" },
    { source: "new-feature-proposed", target: "features-prioritized", label: "prioritize-features" },
    { source: "features-prioritized", target: "stories-created", label: "do-ux-research" },
    { source: "features-prioritized", target: "stories-prioritized", label: "prioritize-stories" },
    { source: "stories-created", target: "stories-prioritized", label: "prioritize-stories" },
    { source: "stories-created", target: "new-feature-proposed", label: "request-feature" },
    { source: "stories-prioritized", target: "tasks-prepared", label: "refine-into-tasks" },
    { source: "tasks-prepared", target: "task-in-progress", label: "begin-implementation" },
    { source: "tasks-prepared", target: "task-completed", label: "close-invalid-task" },
    { source: "tasks-prepared", target: "stories-prioritized", label: "need-more-tasks" },
    { source: "task-in-progress", target: "tests-completed", label: "run-tests" },
    { source: "task-in-progress", target: "tasks-prepared", label: "refine-task" },
    { source: "tests-completed", target: "task-completed", label: "tests-passing" },
    { source: "tests-completed", target: "task-in-progress", label: "tests-failed" },
    { source: "task-completed", target: "tasks-prepared", label: "pick-up-next-task" },
    { source: "task-completed", target: "themes-proposed", label: "research-new-themes" },
    { source: "task-completed", target: "themes-prioritized", label: "prioritize-themes" },
    { source: "task-completed", target: "initiatives-prioritized", label: "prioritize-initiatives" },
    { source: "task-completed", target: "features-prioritized", label: "prioritize-features" },
    { source: "task-completed", target: "stories-prioritized", label: "prioritize-stories" },
];

const resolveTransitionTarget = (
    source: string | undefined,
    transition: string | undefined,
): string | null => {
    if (!source || !transition) {
        return null;
    }
    const match = WORKFLOW_TRANSITIONS.find(
        (link) => link.source === source && link.label === transition,
    );
    return match ? match.target : null;
};

const clampLines = (content: string, maxLines: number): string => {
    if (maxLines <= 0) {
        return "";
    }
    const lines = content.split(/\r?\n/);
    if (lines.length <= maxLines) {
        return content;
    }
    return lines.slice(lines.length - maxLines).join("\n");
};

const updateTurn = (
    state: UiState,
    turnId: number,
    updater: (turn: TurnState) => TurnState,
): UiState => {
    const existing = state.turns.find((turn) => turn.id === turnId);
    const updated = updater(existing ?? createTurn(turnId));
    const remaining = state.turns.filter((turn) => turn.id !== updated.id);
    const nextTurns = clampTurns([...remaining, updated], 12);
    const allowedIds = new Set(nextTurns.map((turn) => turn.id));
    const nextMappings = Object.fromEntries(
        Object.entries(state.turnBySessionId).filter(([, id]) => allowedIds.has(id)),
    );
    const nextState = {
        ...state,
        turns: nextTurns,
        turnBySessionId: nextMappings,
    };
    return normalizeActiveTurnId(nextState);
};

const assignTurnForSession = (
    state: UiState,
    sessionId: string | null,
): { state: UiState; turnId: number } => {
    if (!sessionId) {
        return { state: normalizeActiveTurnId(state), turnId: state.currentTurnId };
    }
    const existing = state.turnBySessionId[sessionId];
    if (existing !== undefined) {
        return { state: normalizeActiveTurnId(state), turnId: existing };
    }
    const usedTurnIds = new Set(Object.values(state.turnBySessionId));
    if (!usedTurnIds.has(state.currentTurnId)) {
        return {
            state: {
                ...state,
                turnBySessionId: {
                    ...state.turnBySessionId,
                    [sessionId]: state.currentTurnId,
                },
            },
            turnId: state.currentTurnId,
        };
    }
    const nextId = state.currentTurnId + 1;
    const nextTurn = createTurn(nextId);
    const nextActiveId =
        state.activeTurnId === state.currentTurnId ? nextId : state.activeTurnId;
    const nextTurns = clampTurns([...state.turns, nextTurn], 12);
    const nextMappings = Object.fromEntries(
        Object.entries({
            ...state.turnBySessionId,
            [sessionId]: nextId,
        }).filter(([, id]) => nextTurns.some((turn) => turn.id === id)),
    );
    const nextState = {
            ...state,
            turns: nextTurns,
            currentTurnId: nextId,
            activeTurnId: nextActiveId,
            turnBySessionId: nextMappings,
    };
    return {
        state: normalizeActiveTurnId(nextState),
        turnId: nextId,
    };
};

const formatSystemMessage = (
    payload: SessionUpdatePayload,
    updateType: string,
): string => {
    const update = (payload.update ?? payload.updates ?? payload) as Record<string, unknown>;
    const title = typeof update.title === "string" ? update.title : "";
    const status = typeof update.status === "string" ? update.status : "";
    const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : "";
    const error = typeof update.error === "string" ? update.error : "";
    const suffixParts = [status, toolCallId, error].filter((part) => part.length > 0);
    const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : "";

    if (updateType === "tool_call") {
        const base = title.length > 0 ? `Tool call: ${title}` : "Tool call";
        return `${base}${suffix}`;
    }
    if (updateType === "tool_call_update") {
        const base = toolCallId.length > 0 ? `Tool update: ${toolCallId}` : "Tool update";
        return `${base}${suffix}`;
    }

    const profile = payload.profileName ? ` ${payload.profileName}` : "";
    const runtime = payload.runtimeName ? ` (${payload.runtimeName})` : "";
    return `${updateType}${profile}${runtime}${suffix}`;
};

const appendSystemMessage = (
    state: UiState,
    payload: SessionUpdatePayload,
    updateType: string,
): UiState => {
    const text = formatSystemMessage(payload, updateType).trim();
    if (text.length === 0) {
        return state;
    }
    const nextId =
        state.systemMessages.length > 0
            ? state.systemMessages[state.systemMessages.length - 1].id + 1
            : 1;
    const entry = {
        id: nextId,
        text,
        timestamp: formatTimestamp(payload.timestamp),
    };
    return {
        ...state,
        systemMessages: clampSystem([...state.systemMessages, entry], 30),
    };
};

const appendSystemText = (state: UiState, text: string): UiState => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return state;
    }
    const nextId =
        state.systemMessages.length > 0
            ? state.systemMessages[state.systemMessages.length - 1].id + 1
            : 1;
    const entry = {
        id: nextId,
        text: trimmed,
        timestamp: new Date().toISOString(),
    };
    return {
        ...state,
        systemMessages: clampSystem([...state.systemMessages, entry], 30),
    };
};

type FileTailState = {
    path: string;
    position: number;
    remainder: string;
};

const createFileTail = (
    filePath: string,
    onLine: (line: string) => void,
): FileTailState => {
    let position = 0;
    try {
        const stat = fs.statSync(filePath);
        position = stat.size;
    } catch {
        position = 0;
    }
    return {
        path: filePath,
        position,
        remainder: "",
    };
};

const readFileTail = (
    state: FileTailState,
    onLine: (line: string) => void,
): FileTailState => {
    try {
        const stat = fs.statSync(state.path);
        if (stat.size < state.position) {
            return { ...state, position: stat.size, remainder: "" };
        }
        if (stat.size === state.position) {
            return state;
        }

        const length = stat.size - state.position;
        const buffer = Buffer.alloc(length);
        const fd = fs.openSync(state.path, "r");
        fs.readSync(fd, buffer, 0, length, state.position);
        fs.closeSync(fd);

        const text = state.remainder + buffer.toString("utf8");
        const lines = text.split(/\r?\n/);
        const remainder = lines.pop() ?? "";
        lines.forEach((line) => {
            if (line.trim().length > 0) {
                onLine(line);
            }
        });

        return {
            ...state,
            position: stat.size,
            remainder,
        };
    } catch {
        return state;
    }
};

const applyUpdate = (state: UiState, payload: SessionUpdatePayload): UiState => {
    const updateTypeRaw = readUpdateType(payload);
    if (!updateTypeRaw) {
        return state;
    }
    const normalizedType = updateTypeRaw.trim().toLowerCase();
    const updateType = normalizedType.replace(/[\s-]+/g, "_");
    const sessionId = readSessionId(payload);
    const { state: metaState, turnId } = assignTurnForSession(state, sessionId);

    const metaUpdate = (turn: TurnState): TurnState => ({
        ...turn,
        sessionId: sessionId ?? turn.sessionId,
        profileName: payload.profileName ?? turn.profileName,
        runtimeName: payload.runtimeName ?? turn.runtimeName,
        modelName: payload.modelName ?? turn.modelName,
        requestedModelName: payload.requestedModelName ?? turn.requestedModelName,
        mcpTools: payload.mcpTools ?? turn.mcpTools,
        taskType: payload.taskType ?? turn.taskType,
        taskId: payload.taskId ?? turn.taskId,
        taskTitle: payload.taskTitle ?? turn.taskTitle,
        workflowState: payload.workflowState ?? turn.workflowState,
        workflowSourceState: payload.workflowSourceState ?? turn.workflowSourceState,
        workflowTargetState: payload.workflowTargetState ?? turn.workflowTargetState,
        workflowTransition: payload.workflowTransition ?? turn.workflowTransition,
        isDecider: payload.isDecider ?? turn.isDecider,
        updatedAt: payload.timestamp ? formatTimestamp(payload.timestamp) : turn.updatedAt,
    });

    if (updateType === "agent_message_chunk") {
        const text = readContentText(payload);
        if (!text) {
            return metaState;
        }
        return updateTurn(metaState, turnId, (turn) =>
            metaUpdate({
                ...turn,
                message: `${turn.message}${text}`,
                updatedAt: new Date().toISOString(),
            }),
        );
    }

    if (updateType === "agent_thought_chunk") {
        const text = readContentText(payload);
        if (!text) {
            return metaState;
        }
        return updateTurn(metaState, turnId, (turn) =>
            metaUpdate({
                ...turn,
                thought: `${turn.thought}${text}`,
                updatedAt: new Date().toISOString(),
            }),
        );
    }

    if (["turn_complete", "end_turn", "session_complete"].includes(updateType)) {
        const markedState = updateTurn(metaState, turnId, (turn) =>
            metaUpdate({
                ...turn,
                isProcessing: false,
            }),
        );
        if (turnId !== markedState.currentTurnId) {
            return markedState;
        }
        const nextId = markedState.currentTurnId + 1;
        const nextTurn = createTurn(nextId);
        const nextActiveId =
            markedState.activeTurnId === markedState.currentTurnId
                ? nextId
                : markedState.activeTurnId;
        const nextTurns = clampTurns([...markedState.turns, nextTurn], 12);
        const nextMappings = Object.fromEntries(
            Object.entries(markedState.turnBySessionId).filter(([, id]) =>
                nextTurns.some((turn) => turn.id === id),
            ),
        );
        const nextState = {
            ...markedState,
            turns: nextTurns,
            currentTurnId: nextId,
            activeTurnId: nextActiveId,
            turnBySessionId: nextMappings,
        };
        return normalizeActiveTurnId(nextState);
    }

    return updateTurn(
        appendSystemMessage(metaState, payload, updateType),
        turnId,
        (turn) => metaUpdate(turn),
    );
};

const SystemBox = ({
    entries,
    isFocused,
    maxLines,
}: {
    entries: Array<{ id: number; text: string; timestamp: string }>;
    isFocused: boolean;
    maxLines: number;
}) => {
    const content =
        entries.length > 0
            ? entries.map((entry) => `[${entry.timestamp}] ${entry.text}`).join("\n")
            : "—";
    return React.createElement(SectionBox, {
        title: "System",
        content,
        borderColor: "blue",
        isFocused,
        maxLines,
    });
};

const SectionBox = ({
    title,
    content,
    borderColor = "gray",
    isFocused = false,
    maxLines,
}: {
    title: string;
    content: string;
    borderColor?: string;
    isFocused?: boolean;
    maxLines?: number;
}) =>
    React.createElement(
        Box,
        {
            borderStyle: isFocused ? "double" : "single",
            borderColor,
            flexDirection: "column",
            paddingX: 1,
            paddingY: 0,
        },
        React.createElement(Text, { color: "gray" }, title),
        React.createElement(
            Text,
            null,
            maxLines ? clampLines(content || "—", maxLines) : content || "—",
        ),
        React.createElement(Text, { color: "gray" }, title),
    );

const TurnBox = ({
    turn,
    isActive,
    focusedBox,
    maxLines,
    spinner,
}: {
    turn: TurnState;
    isActive: boolean;
    focusedBox: FocusTarget;
    maxLines: { thought: number; message: number };
    spinner: string;
}) => {
    const runtimeValue = turn.runtimeName?.toLowerCase();
    const showModel = !runtimeValue || runtimeValue === "opencode";
    const modelLabel = showModel
        ? turn.modelName
            ? `Model: ${turn.modelName}`
            : "Model: —"
        : "Model: —";
    const requestedLabel =
        showModel && turn.requestedModelName
            ? `Requested: ${turn.requestedModelName}`
            : "Requested: —";
    const agentLabel = turn.runtimeName ? `Agent: ${turn.runtimeName}` : "Agent: —";
    const workflowSourceState = turn.workflowSourceState ?? turn.workflowState;
    const workflowTargetState =
        turn.workflowTargetState ??
        resolveTransitionTarget(workflowSourceState, turn.workflowTransition);

    return React.createElement(
        Box,
        {
            borderStyle: "round",
            borderColor: isActive ? "cyan" : "white",
            flexDirection: "column",
            paddingX: 1,
            paddingY: 0,
            marginBottom: 1,
        },
        React.createElement(
            Box,
            { flexDirection: "row", justifyContent: "space-between" },
            React.createElement(Text, { color: "cyan" }, `Turn ${turn.id}`),
            React.createElement(
                Text,
                { color: "gray" },
                `${turn.updatedAt}${turn.isProcessing ? ` ${spinner}` : ""}`,
            ),
        ),
        React.createElement(
            Box,
            { flexDirection: "row", justifyContent: "space-between", marginTop: 1 },
            React.createElement(
                Text,
                { color: "blue" },
                agentLabel,
            ),
            React.createElement(
                Text,
                { color: "green" },
                modelLabel,
            ),
        ),
        React.createElement(
            Box,
            { flexDirection: "row", justifyContent: "flex-end" },
            React.createElement(Text, { color: "gray" }, requestedLabel),
        ),
        React.createElement(
            Box,
            { flexDirection: "column" },
            React.createElement(
                Text,
                { color: "blue" },
                turn.mcpTools && turn.mcpTools.length > 0
                    ? `MCP tools: ${turn.mcpTools.join(", ")}`
                    : "MCP tools: —",
            ),
        ),
        React.createElement(
            Box,
            { flexDirection: "row", justifyContent: "space-between", marginTop: 1 },
            React.createElement(
                Text,
                { color: "yellow" },
                turn.profileName ? `Profile: ${turn.profileName}` : "Profile: —",
            ),
            React.createElement(
                Text,
                { color: "magenta" },
                turn.taskType ? `Type: ${turn.taskType}` : "Type: —",
            ),
        ),
        React.createElement(
            Box,
            { flexDirection: "row", justifyContent: "space-between" },
            React.createElement(
                Text,
                { color: "green" },
                turn.taskId ? `Task: ${turn.taskId}` : "Task: —",
            ),
            React.createElement(
                Text,
                { color: "cyan" },
                turn.workflowTransition
                    ? turn.isDecider
                        ? `Decider: ${turn.workflowTransition}`
                        : `Transition: ${turn.workflowTransition}`
                    : "Transition: —",
            ),
        ),
        React.createElement(
            Box,
            { flexDirection: "row", justifyContent: "space-between" },
            React.createElement(
                Text,
                { color: "magenta" },
                workflowSourceState ? `From: ${workflowSourceState}` : "From: —",
            ),
            React.createElement(
                Text,
                { color: "magenta" },
                workflowTargetState ? `To: ${workflowTargetState}` : "To: —",
            ),
        ),
        React.createElement(
            Box,
            { flexDirection: "column", marginTop: 1 },
            React.createElement(
                Text,
                { color: "white" },
                turn.taskTitle ? `Title: ${turn.taskTitle}` : "Title: —",
            ),
        ),
        React.createElement(
            Box,
            { flexDirection: "column", marginTop: 1 },
            SectionBox({
                title: "Thoughts",
                content: turn.thought,
                borderColor: "magenta",
                isFocused: focusedBox === "thought",
                maxLines: maxLines.thought,
            }),
            React.createElement(Box, { marginTop: 1 }),
            SectionBox({
                title: "Message",
                content: turn.message,
                borderColor: "green",
                isFocused: focusedBox === "message",
                maxLines: maxLines.message,
            }),
        ),
    );
};

const App = () => {
    const [state, setState] = useState<UiState>({
        turns: [createTurn(1)],
        currentTurnId: 1,
        activeTurnId: 1,
        turnBySessionId: {},
        systemMessages: [],
    });
    const [focusedBox, setFocusedBox] = useState<FocusTarget>("message");
    const [maximizedBox, setMaximizedBox] = useState<FocusTarget | null>(null);
    const [lastClickAt, setLastClickAt] = useState<number | null>(null);
    const { stdout } = useStdout();
    const { isRawModeSupported } = useStdin();
    const [terminalSize, setTerminalSize] = useState(() => ({
        columns: stdout.columns ?? 80,
        rows: stdout.rows ?? 24,
    }));

    const focusOrder: FocusTarget[] = ["system", "thought", "message", "prev", "next"];

    useInput(
        (input, key) => {
            const isPrevTurn = key.leftArrow || input === "h" || input === "[";
            const isNextTurn = key.rightArrow || input === "l" || input === "]";
            if (isPrevTurn || isNextTurn) {
                setState((prev) => navigateTurn(prev, isPrevTurn));
                return;
            }

            if (key.tab || input === "\t") {
                const index = focusOrder.indexOf(focusedBox);
                const next =
                    index >= 0 ? focusOrder[(index + (key.shift ? -1 : 1) + focusOrder.length) % focusOrder.length] : "message";
                setFocusedBox(next);
                return;
            }

            if (input === "m") {
                if (focusedBox === "system" || focusedBox === "thought" || focusedBox === "message") {
                    setMaximizedBox((current) => (current ? null : focusedBox));
                }
                return;
            }

            if (key.return || input === "\r" || input === "\n") {
                if (focusedBox === "prev") {
                    setState((prev) => navigateTurn(prev, true));
                    return;
                }
                if (focusedBox === "next") {
                    setState((prev) => navigateTurn(prev, false));
                    return;
                }
            }

            if (key.escape && maximizedBox) {
                setMaximizedBox(null);
                return;
            }

            const now = Date.now();
            const isMouseSequence = input.startsWith("\u001b[M") || input.startsWith("\u001b[<");
            if (isMouseSequence) {
                if (lastClickAt && now - lastClickAt < 400) {
                    if (focusedBox === "system" || focusedBox === "thought" || focusedBox === "message") {
                        setMaximizedBox((current) => (current ? null : focusedBox));
                    }
                }
                setLastClickAt(now);
            }
        },
        { isActive: isRawModeSupported },
    );

    useEffect(() => {
        const onResize = () => {
            setTerminalSize({
                columns: stdout.columns ?? 80,
                rows: stdout.rows ?? 24,
            });
        };
        stdout.on("resize", onResize);
        onResize();

        const enableMouse = () => {
            if (!isRawModeSupported) {
                return;
            }
            process.stdout.write("\u001b[?1000h");
            process.stdout.write("\u001b[?1006h");
        };

        const disableMouse = () => {
            if (!isRawModeSupported) {
                return;
            }
            process.stdout.write("\u001b[?1000l");
            process.stdout.write("\u001b[?1006l");
        };

        enableMouse();

        if (!CLI_CONFIG.streamPath) {
            const input = process.stdin;
            input.setEncoding("utf8");
            let buffer = "";

            const onData = (chunk: string) => {
                buffer += chunk;
                let newlineIndex = buffer.indexOf("\n");
                while (newlineIndex >= 0) {
                    const line = buffer.slice(0, newlineIndex).trim();
                    buffer = buffer.slice(newlineIndex + 1);
                    if (line.length > 0) {
                        try {
                            const payload = JSON.parse(line) as SessionUpdatePayload;
                            setState((prev) => applyUpdate(prev, payload));
                        } catch {
                            setState((prev) => appendSystemText(prev, line));
                        }
                    }
                    newlineIndex = buffer.indexOf("\n");
                }
            };

            input.on("data", onData);
            return () => {
                input.off("data", onData);
                stdout.off("resize", onResize);
                disableMouse();
            };
        }

        const streamPath = CLI_CONFIG.streamPath;
        const logPaths = CLI_CONFIG.logPaths;
        let streamState = streamPath ? createFileTail(streamPath, () => {}) : null;
        let logStates = logPaths.map((logPath) => createFileTail(logPath, () => {}));

        const onStreamLine = (line: string) => {
            try {
                const payload = JSON.parse(line) as SessionUpdatePayload;
                setState((prev) => applyUpdate(prev, payload));
            } catch {
                setState((prev) => appendSystemText(prev, line));
            }
        };

        const onLogLine = (line: string) => {
            setState((prev) => appendSystemText(prev, line));
        };

        const interval = setInterval(() => {
            if (streamState && streamPath) {
                streamState = readFileTail(streamState, onStreamLine);
            }
            logStates = logStates.map((state) => readFileTail(state, onLogLine));
        }, 250);

        return () => {
            clearInterval(interval);
            stdout.off("resize", onResize);
            disableMouse();
        };
    }, [stdout, isRawModeSupported]);

    const sortedTurns = useMemo(
        () => [...state.turns].sort((a, b) => a.id - b.id),
        [state.turns],
    );
    const [spinnerIndex, setSpinnerIndex] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setSpinnerIndex((value) => (value + 1) % 4);
        }, 200);
        return () => clearInterval(interval);
    }, []);

    const spinnerFrames = ["|", "/", "-", "\\"];
    const spinner = spinnerFrames[spinnerIndex];

    const maxLines = {
        system: maximizedBox === "system" ? Math.max(terminalSize.rows - 4, 1) : 7,
        thought: maximizedBox === "thought" ? Math.max(terminalSize.rows - 6, 1) : 7,
        message: maximizedBox === "message" ? Math.max(terminalSize.rows - 6, 1) : 15,
    };

    const activeTurn =
        sortedTurns.find((turn) => turn.id === state.activeTurnId) ?? sortedTurns[0];
    const activeIndex = activeTurn
        ? sortedTurns.findIndex((turn) => turn.id === activeTurn.id)
        : -1;
    const hasPrevTurn = activeIndex > 0;
    const hasNextTurn = activeIndex >= 0 && activeIndex < sortedTurns.length - 1;

    if (maximizedBox === "system") {
        return React.createElement(
            Box,
            { flexDirection: "column", width: terminalSize.columns, height: terminalSize.rows },
            React.createElement(SystemBox, {
                entries: state.systemMessages,
                isFocused: true,
                maxLines: maxLines.system,
            }),
        );
    }

    if (maximizedBox && activeTurn) {
        const content =
            maximizedBox === "thought"
                ? activeTurn.thought
                : activeTurn.message;
        const title =
            maximizedBox === "thought"
                ? "Thoughts"
                : "Message";
        const borderColor =
            maximizedBox === "thought"
                  ? "magenta"
                  : "green";
        const maxLinesForBox =
            maximizedBox === "thought" ? maxLines.thought : maxLines.message;
        return React.createElement(
            Box,
            { flexDirection: "column", width: terminalSize.columns, height: terminalSize.rows },
            React.createElement(SectionBox, {
                title,
                content,
                borderColor,
                isFocused: true,
                maxLines: maxLinesForBox,
            }),
        );
    }

    return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(
            Box,
            { marginBottom: 1 },
            React.createElement(Text, { color: "cyan" }, "ACP Turn Viewer"),
        ),
        React.createElement(SystemBox, {
            entries: state.systemMessages,
            isFocused: focusedBox === "system",
            maxLines: maxLines.system,
        }),
        React.createElement(
            Box,
            { flexDirection: "row", justifyContent: "space-between", marginTop: 1 },
            React.createElement(
                Text,
                {
                    color: hasPrevTurn ? "cyan" : "gray",
                    inverse: focusedBox === "prev",
                    bold: focusedBox === "prev",
                },
                hasPrevTurn ? "◀ Prev" : "◀ Prev",
            ),
            React.createElement(
                Text,
                { color: "gray" },
                activeTurn
                    ? `Turn ${activeTurn.id} (${activeIndex + 1}/${sortedTurns.length})`
                    : "Turn —",
            ),
            React.createElement(
                Text,
                {
                    color: hasNextTurn ? "cyan" : "gray",
                    inverse: focusedBox === "next",
                    bold: focusedBox === "next",
                },
                hasNextTurn ? "Next ▶" : "Next ▶",
            ),
        ),
        activeTurn
            ? React.createElement(TurnBox, {
                key: activeTurn.id,
                turn: activeTurn,
                isActive: true,
                focusedBox,
                maxLines: { thought: maxLines.thought, message: maxLines.message },
                spinner,
            })
            : null,
    );
};

export function runInkUi(): void {
    render(React.createElement(App));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runInkUi();
}
