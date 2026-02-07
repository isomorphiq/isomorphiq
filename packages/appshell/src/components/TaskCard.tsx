// FILE_CONTEXT: "context-b21b6617-c1f3-44de-8560-aeb53783129b"

import type { KeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Task } from "@isomorphiq/tasks/types";
import type { OfflineTask } from "../hooks/useOfflineSync.ts";
import { ActionErrorBanner, useFeedbackToasts } from "./ActionFeedback.tsx";
import { PriorityBadge } from "./PriorityBadge.tsx";
import { TypeBadge } from "./TypeBadge.tsx";

const visuallyHiddenStyle = {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
};

const PRIORITY_OPTIONS: Array<Task["priority"]> = ["high", "medium", "low"];

const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    const tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
};

type InlinePriorityEditorProps = {
    priority: Task["priority"];
    disabled: boolean;
    isSaving: boolean;
    errorMessage: string | null;
    onChange?: (priority: Task["priority"]) => Promise<void> | void;
};

function InlinePriorityEditor({
    priority,
    disabled,
    isSaving,
    errorMessage,
    onChange,
}: InlinePriorityEditorProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [isHovering, setIsHovering] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const selectRef = useRef<HTMLSelectElement | null>(null);

    useEffect(() => {
        if (!isEditing) {
            return;
        }
        selectRef.current?.focus();
    }, [isEditing]);

    const isInteractive = !disabled && Boolean(onChange);
    const showHighlight = isInteractive && (isHovering || isFocused);

    const handleStartEditing = () => {
        if (!isInteractive) {
            return;
        }
        setLocalError(null);
        setIsEditing(true);
    };

    const handleStopEditing = () => {
        setIsEditing(false);
        setIsFocused(false);
    };

    const handleSelectionChange = async (value: string) => {
        const nextPriority = PRIORITY_OPTIONS.find((option) => option === value);
        if (!nextPriority) {
            setLocalError("Invalid priority.");
            return;
        }
        setLocalError(null);
        if (nextPriority === priority) {
            handleStopEditing();
            return;
        }
        await onChange?.(nextPriority);
        handleStopEditing();
    };

    const handleSelectKeyDown = (event: KeyboardEvent<HTMLSelectElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            handleStopEditing();
        }
    };

    const combinedError = errorMessage ?? localError;

    return (
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            {isEditing ? (
                <select
                    ref={selectRef}
                    value={priority}
                    disabled={disabled}
                    aria-label="Task priority"
                    onBlur={handleStopEditing}
                    onKeyDown={handleSelectKeyDown}
                    onChange={(event) => void handleSelectionChange(event.target.value)}
                    style={{
                        padding: "4px 8px",
                        borderRadius: "999px",
                        border: "1px solid var(--color-accent-secondary)",
                        background: "var(--color-surface-primary)",
                        color: "var(--color-text-primary)",
                        fontSize: "12px",
                        cursor: disabled ? "not-allowed" : "pointer",
                    }}
                >
                    {PRIORITY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
            ) : (
                <button
                    type="button"
                    onClick={handleStartEditing}
                    onMouseEnter={() => setIsHovering(true)}
                    onMouseLeave={() => setIsHovering(false)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    disabled={!isInteractive}
                    aria-label={isInteractive ? "Edit task priority" : "Task priority"}
                    title={isInteractive ? "Edit priority" : "Priority"}
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        borderRadius: "999px",
                        padding: "4px 8px",
                        border: showHighlight
                            ? "1px solid var(--color-accent-secondary)"
                            : "1px solid transparent",
                        background: showHighlight ? "var(--color-state-active-bg)" : "transparent",
                        color: "var(--color-text-primary)",
                        fontSize: "12px",
                        cursor: isInteractive ? "pointer" : "default",
                        transition: "border-color 140ms ease, background 140ms ease",
                    }}
                >
                    <PriorityBadge priority={priority} />
                    <span style={{ fontSize: "10px", opacity: 0.7 }}>v</span>
                </button>
            )}
            {isSaving ? (
                <span style={{ fontSize: "11px", color: "var(--color-accent-secondary)" }}>Saving...</span>
            ) : null}
            {combinedError ? (
                <span style={{ fontSize: "11px", color: "var(--color-accent-error)" }}>{combinedError}</span>
            ) : null}
        </div>
    );
}

type TaskCardProps = {
    task: Task | OfflineTask;
    highlight?: boolean;
    showIndex?: number;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
};

type ActionError = {
    message: string;
    actionLabel?: string;
    onAction?: () => void;
};

export function TaskCard({
    task,
    highlight = false,
    showIndex,
    onStatusChange,
    onPriorityChange,
    onDelete,
}: TaskCardProps) {
    const [isUpdating, setIsUpdating] = useState(false);
    const [actionError, setActionError] = useState<ActionError | null>(null);
    const [priorityError, setPriorityError] = useState<string | null>(null);
    const [prioritySaving, setPrioritySaving] = useState(false);
    const [statusAnnouncement, setStatusAnnouncement] = useState("");
    const hasMountedStatusRef = useRef(false);
    const lastStatusRef = useRef("");
    const { pushToast } = useFeedbackToasts();

    const handleStatusChange = async (newStatus: Task["status"]) => {
        if (!onStatusChange || isUpdating) return;

        setIsUpdating(true);
        setActionError(null);
        try {
            await onStatusChange(task.id, newStatus);
            const statusLabel = newStatus.replace("-", " ");
            const message =
                newStatus === "done"
                    ? `Marked "${task.title}" complete.`
                    : `Set "${task.title}" to ${statusLabel}.`;
            pushToast({ message, tone: "success" });
        } catch (error) {
            console.error("Failed to update status:", error);
            setActionError({
                message: error instanceof Error ? error.message : "Failed to update task status.",
                actionLabel: "Retry",
                onAction: () => void handleStatusChange(newStatus),
            });
        } finally {
            setIsUpdating(false);
        }
    };

    const handlePriorityChange = async (newPriority: Task["priority"]) => {
        if (!onPriorityChange || isUpdating) return;
        if (!PRIORITY_OPTIONS.includes(newPriority)) {
            setPriorityError("Invalid priority selected.");
            return;
        }
        if (newPriority === task.priority) {
            return;
        }

        setIsUpdating(true);
        setPrioritySaving(true);
        setPriorityError(null);
        setActionError(null);
        try {
            await onPriorityChange(task.id, newPriority);
            pushToast({ message: `Priority set to ${newPriority}.`, tone: "success" });
        } catch (error) {
            console.error("Failed to update priority:", error);
            setActionError({
                message: error instanceof Error ? error.message : "Failed to update priority.",
                actionLabel: "Retry",
                onAction: () => void handlePriorityChange(newPriority),
            });
        } finally {
            setIsUpdating(false);
            setPrioritySaving(false);
        }
    };

    const handleDelete = async () => {
        if (!onDelete || isUpdating) return;

        if (window.confirm("Are you sure you want to delete this task?")) {
            setIsUpdating(true);
            setActionError(null);
            try {
                await onDelete(task.id);
                pushToast({ message: `Deleted "${task.title}".`, tone: "success" });
            } catch (error) {
                console.error("Failed to delete task:", error);
                setActionError({
                    message: error instanceof Error ? error.message : "Failed to delete task.",
                    actionLabel: "Retry",
                    onAction: () => void handleDelete(),
                });
            } finally {
                setIsUpdating(false);
            }
        }
    };

    const statusTokens: Record<Task["status"], { color: string; border: string }> = {
        todo: { color: "var(--color-accent-primary)", border: "var(--color-accent-primary)" },
        "in-progress": { color: "var(--color-accent-warning)", border: "var(--color-accent-warning)" },
        done: { color: "var(--color-accent-success)", border: "var(--color-accent-success)" },
    };
    const statusLabel = task.status.replace("-", " ");
    const statusToken = statusTokens[task.status];
    const createdAt = new Date(task.createdAt);
    const updatedAt = new Date(task.updatedAt);

    useEffect(() => {
        if (!hasMountedStatusRef.current) {
            hasMountedStatusRef.current = true;
            return;
        }
        const nextMessage = `Task ${task.title} marked ${statusLabel}.`;
        if (nextMessage === lastStatusRef.current) {
            return;
        }
        const timeout = setTimeout(() => {
            lastStatusRef.current = nextMessage;
            setStatusAnnouncement(nextMessage);
        }, 120);
        return () => clearTimeout(timeout);
    }, [task.status, task.title, statusLabel]);

    useEffect(() => {
        setActionError(null);
    }, [task.status, task.priority]);

    const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
            return;
        }
        if (isEditableTarget(event.target)) {
            return;
        }
        if (event.key.toLowerCase() === "c" && task.status !== "done") {
            event.preventDefault();
            void handleStatusChange("done");
        }
    };

    return (
        <article
            aria-label={`Task ${task.title}, status ${statusLabel}`}
            aria-keyshortcuts="C"
            tabIndex={0}
            onKeyDown={handleCardKeyDown}
            style={{
                padding: "16px",
                borderRadius: "10px",
                border: highlight
                    ? "2px solid var(--color-accent-secondary)"
                    : "1px solid var(--color-border-secondary)",
                background: highlight ? "var(--color-state-active-bg)" : "var(--color-surface-secondary)",
                position: "relative",
                opacity: isUpdating ? 0.6 : 1,
                boxShadow: highlight ? "0 12px 28px var(--color-shadow-xl)" : "0 10px 20px var(--color-shadow-lg)",
            }}
        >
            <div role="status" aria-live="polite" aria-atomic="true" style={visuallyHiddenStyle}>
                {statusAnnouncement}
            </div>
            {actionError ? (
                <div style={{ marginBottom: "12px" }}>
                    <ActionErrorBanner
                        message={actionError.message}
                        actionLabel={actionError.actionLabel}
                        onAction={actionError.onAction}
                        onDismiss={() => setActionError(null)}
                    />
                </div>
            ) : null}
            {/* Header */}
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "10px",
                    marginBottom: "12px",
                    flexWrap: "wrap",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    {typeof showIndex === "number" && (
                        <span style={{ color: "var(--color-accent-secondary)", fontWeight: 600, fontSize: "14px" }}>
                            {showIndex + 1}
                        </span>
                    )}
                    <TypeBadge type={task.type ?? "task"} />
                    {onPriorityChange ? (
                        <InlinePriorityEditor
                            priority={task.priority}
                            disabled={isUpdating}
                            isSaving={prioritySaving}
                            errorMessage={priorityError}
                            onChange={handlePriorityChange}
                        />
                    ) : (
                        <PriorityBadge priority={task.priority} />
                    )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span
                        aria-label={`Status ${statusLabel}`}
                        style={{
                            fontSize: "12px",
                            color: statusToken.color,
                            fontWeight: "600",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            border: `1px solid ${statusToken.border}`,
                            background: "transparent",
                        }}
                    >
                        {statusLabel}
                    </span>

                    {onDelete && (
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={isUpdating}
                            aria-label={`Delete ${task.title}`}
                            style={{
                                background: "none",
                                border: "none",
                                color: "var(--color-accent-error)",
                                cursor: isUpdating ? "not-allowed" : "pointer",
                                fontSize: "16px",
                                padding: "2px",
                                borderRadius: "4px",
                            }}
                            title="Delete task"
                        >
                            ×
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", color: "var(--color-text-primary)" }}>
                <Link
                    to={`/tasks/${task.id}`}
                    style={{ color: "var(--color-text-primary)", textDecoration: "none" }}
                >
                    {task.title}
                </Link>
            </h3>
            <p
                style={{
                    margin: "0 0 12px 0",
                    color: "var(--color-text-secondary)",
                    fontSize: "14px",
                    lineHeight: "1.4",
                }}
            >
                {task.description}
            </p>

            {/* Actions */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                {onStatusChange && task.status !== "done" && (
                    <button
                        type="button"
                        onClick={() => void handleStatusChange("done")}
                        disabled={isUpdating}
                        aria-label={`Mark ${task.title} complete`}
                        aria-keyshortcuts="C"
                        style={{
                            padding: "4px 10px",
                            borderRadius: "6px",
                            border: "1px solid var(--color-accent-success)",
                            background: isUpdating
                                ? "var(--color-surface-tertiary)"
                                : "var(--color-accent-success)",
                            color: "var(--color-text-on-accent)",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: isUpdating ? "not-allowed" : "pointer",
                            transition: "background 140ms ease, border-color 140ms ease",
                            opacity: isUpdating ? 0.7 : 1,
                        }}
                        title="Shortcut: C"
                    >
                        Mark complete
                    </button>
                )}

                {onStatusChange && task.status !== "done" && (
                    <select
                        value={task.status}
                        onChange={(e) => handleStatusChange(e.target.value as Task["status"])}
                        disabled={isUpdating}
                        aria-label={`Update status for ${task.title}`}
                        style={{
                            padding: "4px 8px",
                            borderRadius: "4px",
                            border: "1px solid var(--color-border-secondary)",
                            background: "var(--color-surface-primary)",
                            color: "var(--color-text-primary)",
                            fontSize: "12px",
                        }}
                    >
                        <option value="todo">Todo</option>
                        <option value="in-progress">In Progress</option>
                        <option value="done">Done</option>
                    </select>
                )}

            </div>

            {/* User Information */}
            {(task.assignedTo || task.collaborators?.length) && (
                <div
                    style={{
                        display: "flex",
                        gap: "8px",
                        marginBottom: "8px",
                        fontSize: "12px",
                        color: "var(--color-text-muted)",
                    }}
                >
                    {task.assignedTo && (
                        <span
                            style={{
                                background: "transparent",
                                color: "var(--color-accent-primary)",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                border: "1px solid var(--color-accent-primary)",
                            }}
                        >
                            Assigned to: {task.assignedTo}
                        </span>
                    )}
                    {task.collaborators && task.collaborators.length > 0 && (
                        <span
                            style={{
                                background: "transparent",
                                color: "var(--color-accent-success)",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                border: "1px solid var(--color-accent-success)",
                            }}
                        >
                            {task.collaborators.length} collaborator{task.collaborators.length !== 1 ? "s" : ""}
                        </span>
                    )}
                </div>
            )}

            {/* Dependencies */}
            {task.dependencies && task.dependencies.length > 0 && (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                        marginBottom: "8px",
                        fontSize: "12px",
                        color: "var(--color-text-secondary)",
                    }}
                >
                    <span style={{ color: "var(--color-text-muted)", fontWeight: 600 }}>Depends on:</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {task.dependencies.map((dep) => (
                            <span
                                key={dep}
                                style={{
                                    background: "var(--color-surface-primary)",
                                    border: "1px solid var(--color-border-secondary)",
                                    borderRadius: "6px",
                                    padding: "4px 6px",
                                    color: "var(--color-text-primary)",
                                    fontFamily: "monospace",
                                    wordBreak: "break-all",
                                }}
                            >
                                {dep}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Footer */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    color: "var(--color-text-muted)",
                    fontSize: "11px",
                    borderTop: "1px solid var(--color-border-secondary)",
                    paddingTop: "8px",
                    gap: "8px",
                }}
            >
                <span>Created: {createdAt.toLocaleDateString()}</span>
                <span>Updated: {updatedAt.toLocaleDateString()}</span>
                <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>ID: {task.id}</span>
            </div>
        </article>
    );
}

type TaskListProps = {
    tasks: Array<Task | OfflineTask>;
    empty: string;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
};

export function TaskList({
    tasks,
    empty,
    onStatusChange,
    onPriorityChange,
    onDelete,
}: TaskListProps) {
    if (!tasks.length) {
        return (
            <p role="status" aria-live="polite" style={{ color: "var(--color-text-muted)", margin: 0 }}>
                {empty}
            </p>
        );
    }
    return (
        <ul
            aria-label="Tasks"
            style={{
                display: "grid",
                gap: "12px",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                listStyle: "none",
                padding: 0,
                margin: 0,
            }}
        >
            {tasks.map((task) => (
                <li key={task.id} style={{ listStyle: "none" }}>
                    <TaskCard
                        task={task}
                        onStatusChange={onStatusChange}
                        onPriorityChange={onPriorityChange}
                        onDelete={onDelete}
                    />
                </li>
            ))}
        </ul>
    );
}

type QueueListProps = {
    tasks: Array<Task | OfflineTask>;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
    remainingCount?: number;
    onLoadMore?: () => void;
    stacked?: boolean;
};

export function QueueList({
    tasks,
    onStatusChange,
    onPriorityChange,
    onDelete,
    remainingCount = 0,
    onLoadMore,
    stacked = false,
}: QueueListProps) {
    // Render with highest-priority/rightmost; we reverse so natural scroll keeps current at right edge.
    const ordered = [...tasks].reverse();
    const scrollRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        if (!stacked && scrollRef.current) {
            scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
    }, [stacked]);

    if (!tasks.length) {
        return (
            <p role="status" aria-live="polite" style={{ color: "var(--color-text-muted)", margin: 0 }}>
                Queue is empty.
            </p>
        );
    }

    const renderLoadMore = () =>
        remainingCount > 0 && onLoadMore ? (
            <li
                style={{
                    minWidth: stacked ? "auto" : "300px",
                    maxWidth: stacked ? "none" : "320px",
                    flex: stacked ? "1 1 100%" : "0 0 auto",
                    display: "flex",
                    alignItems: "stretch",
                    marginTop: "4px",
                    listStyle: "none",
                }}
            >
                <button
                    type="button"
                    onClick={onLoadMore}
                    aria-label={`Load more queued tasks, ${remainingCount} remaining`}
                    style={{
                        width: "100%",
                        padding: stacked ? "12px" : "16px",
                        borderRadius: "10px",
                        border: "1px dashed var(--color-border-secondary)",
                        background: "var(--color-surface-primary)",
                        color: "var(--color-text-primary)",
                        fontSize: "14px",
                        fontWeight: 600,
                        cursor: "pointer",
                        textAlign: "center",
                        boxShadow: "0 10px 20px var(--color-shadow-lg)",
                    }}
                >
                    Load more ({remainingCount} remaining)
                </button>
            </li>
        ) : null;

    if (stacked) {
        return (
            <ul
                aria-label="Queued tasks"
                style={{ display: "grid", gap: "12px", listStyle: "none", padding: 0, margin: 0 }}
            >
                {ordered.map((task, idx) => (
                    <li key={task.id} style={{ listStyle: "none" }}>
                        <TaskCard
                            task={task}
                            highlight={idx === ordered.length - 1}
                            showIndex={ordered.length - 1 - idx}
                            onStatusChange={onStatusChange}
                            onPriorityChange={onPriorityChange}
                            onDelete={onDelete}
                        />
                    </li>
                ))}
                {renderLoadMore()}
            </ul>
        );
    }

    return (
        <div
            ref={scrollRef}
            role="region"
            aria-label="Queued tasks"
            tabIndex={0}
            style={{
                width: "100%",
                overflowX: "auto",
                overflowY: "hidden",
                paddingBottom: "8px",
                scrollbarWidth: "auto",
                WebkitOverflowScrolling: "touch",
            }}
        >
            <ul
                aria-label="Queued tasks"
                style={{
                    display: "inline-flex",
                    gap: "12px",
                    paddingLeft: "min(40px, 10vw)", // give some leading space so items can sit to the right
                    justifyContent: "flex-start",
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                }}
            >
                {renderLoadMore()}
                {/* render so the rightmost item is the highest priority (original first) */}
                {ordered.map((task, idx) => (
                    <li
                        key={task.id}
                        style={{
                            minWidth: "300px",
                            maxWidth: "360px",
                            maxHeight: "360px",
                            overflowY: "auto",
                            flex: "0 0 auto",
                            listStyle: "none",
                        }}
                    >
                        <TaskCard
                            task={task}
                            highlight={idx === ordered.length - 1}
                            showIndex={ordered.length - 1 - idx}
                            onStatusChange={onStatusChange}
                            onPriorityChange={onPriorityChange}
                            onDelete={onDelete}
                        />
                    </li>
                ))}
            </ul>
        </div>
    );
}
