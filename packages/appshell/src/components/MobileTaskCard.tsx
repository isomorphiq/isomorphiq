// FILE_CONTEXT: "context-2d6dbc05-129a-42c7-aef8-82ff3ad93acb"

import type { KeyboardEvent } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Task } from "@isomorphiq/tasks/types";
import { ActionErrorBanner, useFeedbackToasts } from "./ActionFeedback.tsx";
import { PriorityBadge } from "./PriorityBadge.tsx";
import { TypeBadge } from "./TypeBadge.tsx";

type MobileTaskCardProps = {
    task: Task & { isOffline?: boolean }; // Allow for offline tasks
    highlight?: boolean;
    showIndex?: number;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
    compact?: boolean;
};

type ActionError = {
    message: string;
    actionLabel?: string;
    onAction?: () => void;
};

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

const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    const tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
};

export function MobileTaskCard({
    task,
    highlight = false,
    showIndex,
    onStatusChange,
    onPriorityChange,
    onDelete,
    compact = false,
}: MobileTaskCardProps) {
    const [isUpdating, setIsUpdating] = useState(false);
    const [showActions, setShowActions] = useState(false);
    const [statusAnnouncement, setStatusAnnouncement] = useState("");
    const [actionError, setActionError] = useState<ActionError | null>(null);
    const hasMountedStatusRef = useRef(false);
    const lastStatusRef = useRef("");
    const actionsId = useId();
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
            setShowActions(true);
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

        setIsUpdating(true);
        setActionError(null);
        try {
            await onPriorityChange(task.id, newPriority);
            pushToast({ message: `Priority set to ${newPriority}.`, tone: "success" });
        } catch (error) {
            console.error("Failed to update priority:", error);
            setShowActions(true);
            setActionError({
                message: error instanceof Error ? error.message : "Failed to update priority.",
                actionLabel: "Retry",
                onAction: () => void handlePriorityChange(newPriority),
            });
        } finally {
            setIsUpdating(false);
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
                setShowActions(true);
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

    const statusColors: Record<Task["status"], string> = {
        todo: "#3b82f6",
        "in-progress": "#f59e0b",
        done: "#10b981",
    };
    const statusLabel = task.status.replace("-", " ");

    const isMobile = window.innerWidth <= 768;
    const cardPadding = compact ? (isMobile ? "12px" : "16px") : isMobile ? "16px" : "20px";

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

    const handleCardKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
            return;
        }
        if (isEditableTarget(event.target)) {
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void handleStatusChange("done");
            return;
        }
        if (event.key.toLowerCase() === "c" && task.status !== "done") {
            event.preventDefault();
            void handleStatusChange("done");
        }
    };

    return (
        <button
            type="button"
            aria-label={`Task ${task.title}, status ${statusLabel}`}
            aria-expanded={showActions}
            aria-controls={actionsId}
            aria-keyshortcuts="C"
            style={{
                padding: cardPadding,
                borderRadius: "12px",
                border: highlight ? "2px solid #38bdf8" : "1px solid #1f2937",
                background: highlight ? "#0b1f33" : "#0b1220",
                position: "relative",
                opacity: isUpdating ? 0.6 : 1,
                boxShadow: highlight
                    ? "0 12px 28px rgba(56, 189, 248, 0.25)"
                    : "0 10px 20px rgba(0,0,0,0.25)",
                transition: "all 0.2s ease",
                cursor: "pointer",
                transform: showActions ? "scale(1.02)" : "scale(1)",
                textAlign: "left",
            }}
            onClick={() => setShowActions(!showActions)}
            onTouchStart={() => {
                // Add haptic feedback if available
                if ("vibrate" in navigator) {
                    navigator.vibrate(10);
                }
            }}
            onKeyDown={handleCardKeyDown}
        >
            <div role="status" aria-live="polite" aria-atomic="true" style={visuallyHiddenStyle}>
                {statusAnnouncement}
            </div>
            {/* Offline Indicator */}
            {task.isOffline && (
                <div
                    style={{
                        position: "absolute",
                        top: "8px",
                        right: "8px",
                        background: "#f59e0b",
                        color: "white",
                        padding: "2px 6px",
                        borderRadius: "8px",
                        fontSize: "10px",
                        fontWeight: 600,
                        zIndex: 10,
                    }}
                >
                    Offline
                </div>
            )}

            {actionError ? (
                <div
                    style={{ marginBottom: "12px" }}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                >
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
                    alignItems: "flex-start",
                    gap: "10px",
                    marginBottom: compact ? "8px" : "12px",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
                    {typeof showIndex === "number" && (
                        <span
                            style={{
                                color: "#a5b4fc",
                                fontWeight: 600,
                                fontSize: isMobile ? "12px" : "14px",
                                background: "#1e1b4b20",
                                padding: "2px 6px",
                                borderRadius: "6px",
                            }}
                        >
                            {showIndex + 1}
                        </span>
                    )}
                    <TypeBadge type={task.type ?? "task"} />
                    <PriorityBadge priority={task.priority} />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                        aria-label={`Status ${statusLabel}`}
                        style={{
                            fontSize: isMobile ? "10px" : "12px",
                            color: statusColors[task.status],
                            fontWeight: "500",
                            padding: "2px 6px",
                            borderRadius: "12px",
                            background: `${statusColors[task.status]}20`,
                        }}
                    >
                        {statusLabel}
                    </span>

                    {onDelete && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDelete();
                            }}
                            disabled={isUpdating}
                            aria-label={`Delete ${task.title}`}
                            style={{
                                background: "none",
                                border: "none",
                                color: "#ef4444",
                                cursor: isUpdating ? "not-allowed" : "pointer",
                                fontSize: isMobile ? "14px" : "16px",
                                padding: "4px",
                                borderRadius: "4px",
                                minWidth: isMobile ? "24px" : "32px",
                                height: isMobile ? "24px" : "32px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                            title="Delete task"
                        >
                            ×
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <h3
                style={{
                    margin: "0 0 6px 0",
                    fontSize: isMobile ? "14px" : "16px",
                    color: "#f9fafb",
                    lineHeight: 1.3,
                    fontWeight: 600,
                }}
            >
                <Link
                    to={`/tasks/${task.id}`}
                    style={{ color: "#f9fafb", textDecoration: "none" }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {task.title}
                </Link>
            </h3>

            {!compact && (
                <p
                    style={{
                        margin: "0 0 12px 0",
                        color: "#cbd5e1",
                        fontSize: isMobile ? "12px" : "14px",
                        lineHeight: 1.4,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                    }}
                >
                    {task.description}
                </p>
            )}

            {/* Expandable Actions */}
            {showActions && (
                <section
                    id={actionsId}
                    aria-label="Task actions"
                    style={{
                        marginTop: "12px",
                        padding: "12px",
                        background: "#1f293730",
                        borderRadius: "8px",
                        border: "1px solid #1f2937",
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                >
                    <div
                        style={{
                            display: "flex",
                            gap: "8px",
                            marginBottom: "12px",
                            flexWrap: "wrap",
                        }}
                    >
                        {onStatusChange && task.status !== "done" && (
                            <button
                                type="button"
                                onClick={() => void handleStatusChange("done")}
                                disabled={isUpdating}
                                aria-label={`Mark ${task.title} complete`}
                                aria-keyshortcuts="C"
                                style={{
                                    padding: "6px 10px",
                                    borderRadius: "6px",
                                    border: "1px solid #10b981",
                                    background: isUpdating ? "#064e3b" : "#0f766e",
                                    color: "#ecfeff",
                                    fontSize: isMobile ? "12px" : "14px",
                                    fontWeight: 600,
                                    cursor: isUpdating ? "not-allowed" : "pointer",
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
                                    padding: "6px 10px",
                                    borderRadius: "6px",
                                    border: "1px solid #374151",
                                    background: "#1f2937",
                                    color: "#f9fafb",
                                    fontSize: isMobile ? "12px" : "14px",
                                    cursor: "pointer",
                                    minWidth: "100px",
                                }}
                            >
                                <option value="todo">Todo</option>
                                <option value="in-progress">In Progress</option>
                                <option value="done">Done</option>
                            </select>
                        )}

                        {onPriorityChange && (
                            <select
                                value={task.priority}
                                onChange={(e) => handlePriorityChange(e.target.value as Task["priority"])}
                                disabled={isUpdating}
                                aria-label={`Update priority for ${task.title}`}
                                style={{
                                    padding: "6px 10px",
                                    borderRadius: "6px",
                                    border: "1px solid #374151",
                                    background: "#1f2937",
                                    color: "#f9fafb",
                                    fontSize: isMobile ? "12px" : "14px",
                                    cursor: "pointer",
                                    minWidth: "100px",
                                }}
                            >
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                            </select>
                        )}
                    </div>

                    {/* User Information */}
                    {(task.assignedTo || task.collaborators?.length) && (
                        <div
                            style={{
                                display: "flex",
                                gap: "6px",
                                marginBottom: "8px",
                                fontSize: isMobile ? "10px" : "12px",
                                color: "#94a3b8",
                                flexWrap: "wrap",
                            }}
                        >
                            {task.assignedTo && (
                                <span
                                    style={{
                                        background: "#1e40af20",
                                        color: "#60a5fa",
                                        padding: "2px 6px",
                                        borderRadius: "4px",
                                        border: "1px solid #1e40af50",
                                    }}
                                >
                                    👤 {task.assignedTo}
                                </span>
                            )}
                            {task.collaborators && task.collaborators.length > 0 && (
                                <span
                                    style={{
                                        background: "#16653420",
                                        color: "#4ade80",
                                        padding: "2px 6px",
                                        borderRadius: "4px",
                                        border: "1px solid #16653450",
                                    }}
                                >
                                    👥 {task.collaborators.length}
                                </span>
                            )}
                        </div>
                    )}

                    {/* Dependencies */}
                    {task.dependencies && task.dependencies.length > 0 && (
                        <div
                            style={{
                                marginBottom: "8px",
                                fontSize: isMobile ? "10px" : "12px",
                                color: "#cbd5e1",
                            }}
                        >
                            <div style={{ color: "#9ca3af", fontWeight: 600, marginBottom: "4px" }}>
                                Dependencies:
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                {task.dependencies.slice(0, 3).map((dep: string) => (
                                    <span
                                        key={dep}
                                        style={{
                                            background: "#1f2937",
                                            border: "1px solid #374151",
                                            borderRadius: "4px",
                                            padding: "2px 4px",
                                            fontFamily: "monospace",
                                            fontSize: "10px",
                                        }}
                                    >
                                        {dep.substring(0, 8)}...
                                    </span>
                                ))}
                                {task.dependencies.length > 3 && (
                                    <span style={{ color: "#9ca3af" }}>+{task.dependencies.length - 3} more</span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Footer */}
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            color: "#64748b",
                            fontSize: isMobile ? "9px" : "11px",
                            borderTop: "1px solid #1f2937",
                            paddingTop: "8px",
                            flexWrap: "wrap",
                            gap: "4px",
                        }}
                    >
                        <span>Created: {new Date(task.createdAt).toLocaleDateString()}</span>
                        <span>Updated: {new Date(task.updatedAt).toLocaleDateString()}</span>
                        {!isMobile && (
                            <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                                ID: {task.id.substring(0, 8)}...
                            </span>
                        )}
                    </div>
                </section>
            )}

            {/* Touch Hint */}
            {isMobile && !showActions && (
                <div
                    style={{
                        textAlign: "center",
                        color: "#64748b",
                        fontSize: "10px",
                        marginTop: "8px",
                        fontStyle: "italic",
                    }}
                >
                    Tap to expand
                </div>
            )}
        </button>
    );
}

type MobileTaskListProps = {
    tasks: Task[];
    empty: string;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
    compact?: boolean;
};

export function MobileTaskList({
    tasks,
    empty,
    onStatusChange,
    onPriorityChange,
    onDelete,
    compact = false,
}: MobileTaskListProps) {
    const isMobile = window.innerWidth <= 768;

    if (!tasks.length) {
        return (
            <div
                role="status"
                aria-live="polite"
                style={{
                    textAlign: "center",
                    padding: isMobile ? "40px 20px" : "60px 40px",
                    color: "#94a3b8",
                }}
            >
                <div style={{ fontSize: isMobile ? "32px" : "48px", marginBottom: "16px" }}>📋</div>
                <p style={{ margin: 0, fontSize: isMobile ? "14px" : "16px" }}>{empty}</p>
            </div>
        );
    }

    return (
        <div role="list" aria-label="Tasks" style={{ display: "grid", gap: isMobile ? "8px" : "12px" }}>
            {tasks.map((task) => (
                <MobileTaskCard
                    key={task.id}
                    task={task}
                    compact={compact}
                    onStatusChange={onStatusChange}
                    onPriorityChange={onPriorityChange}
                    onDelete={onDelete}
                />
            ))}
        </div>
    );
}

type MobileQueueListProps = {
    tasks: Task[];
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
};

export function MobileQueueList({
    tasks,
    onStatusChange,
    onPriorityChange,
    onDelete,
}: MobileQueueListProps) {
    const isMobile = window.innerWidth <= 768;
    const scrollRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        if (scrollRef.current && !isMobile) {
            scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
    }, [isMobile]);

    if (!tasks.length) {
        return (
            <div
                role="status"
                aria-live="polite"
                style={{
                    textAlign: "center",
                    padding: isMobile ? "40px 20px" : "60px 40px",
                    color: "#94a3b8",
                }}
            >
                <div style={{ fontSize: isMobile ? "32px" : "48px", marginBottom: "16px" }}>🎯</div>
                <p style={{ margin: 0, fontSize: isMobile ? "14px" : "16px" }}>Queue is empty.</p>
            </div>
        );
    }

    if (isMobile) {
        // On mobile, show as a vertical list instead of horizontal scroll
        return (
            <div role="list" aria-label="Queued tasks" style={{ display: "grid", gap: "12px" }}>
                {tasks.map((task, idx) => (
                    <MobileTaskCard
                        key={task.id}
                        task={task}
                        highlight={idx === 0}
                        showIndex={idx}
                        compact={true}
                        onStatusChange={onStatusChange}
                        onPriorityChange={onPriorityChange}
                        onDelete={onDelete}
                    />
                ))}
            </div>
        );
    }

    // Desktop horizontal scroll
    return (
        <div
            ref={scrollRef}
            role="region"
            aria-label="Queued tasks"
            style={{
                width: "100%",
                overflowX: "auto",
                overflowY: "hidden",
                paddingBottom: "8px",
                scrollbarWidth: "auto",
                WebkitOverflowScrolling: "touch",
            }}
        >
            <div
                role="list"
                aria-label="Queued tasks"
                style={{
                    display: "inline-flex",
                    gap: "12px",
                    paddingLeft: "min(40px, 10vw)",
                    justifyContent: "flex-start",
                }}
            >
                {tasks.map((task, idx) => (
                    <div
                        key={task.id}
                        style={{
                            minWidth: "300px",
                            maxWidth: "360px",
                            maxHeight: "360px",
                            overflowY: "auto",
                            flex: "0 0 auto",
                        }}
                    >
                        <MobileTaskCard
                            task={task}
                            highlight={idx === 0}
                            showIndex={idx}
                            onStatusChange={onStatusChange}
                            onPriorityChange={onPriorityChange}
                            onDelete={onDelete}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
