import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Task } from "@isomorphiq/tasks/types";
import { PriorityBadge } from "./PriorityBadge.tsx";
import { TypeBadge } from "./TypeBadge.tsx";

interface MobileTaskCardProps {
    task: Task & { isOffline?: boolean }; // Allow for offline tasks
    highlight?: boolean;
    showIndex?: number;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
    compact?: boolean;
}

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

    const handleStatusChange = async (newStatus: Task["status"]) => {
        if (!onStatusChange || isUpdating) return;

        setIsUpdating(true);
        try {
            await onStatusChange(task.id, newStatus);
        } catch (error) {
            console.error("Failed to update status:", error);
        } finally {
            setIsUpdating(false);
        }
    };

    const handlePriorityChange = async (newPriority: Task["priority"]) => {
        if (!onPriorityChange || isUpdating) return;

        setIsUpdating(true);
        try {
            await onPriorityChange(task.id, newPriority);
        } catch (error) {
            console.error("Failed to update priority:", error);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleDelete = async () => {
        if (!onDelete || isUpdating) return;

        if (window.confirm("Are you sure you want to delete this task?")) {
            setIsUpdating(true);
            try {
                await onDelete(task.id);
            } catch (error) {
                console.error("Failed to delete task:", error);
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

    const isMobile = window.innerWidth <= 768;
    const cardPadding = compact ? (isMobile ? "12px" : "16px") : isMobile ? "16px" : "20px";

    return (
        <button
            type="button"
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
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    handleStatusChange("done" as Task["status"]);
                }
            }}
        >
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
                        style={{
                            fontSize: isMobile ? "10px" : "12px",
                            color: statusColors[task.status],
                            fontWeight: "500",
                            padding: "2px 6px",
                            borderRadius: "12px",
                            background: `${statusColors[task.status]}20`,
                        }}
                    >
                        {task.status.replace("-", " ")}
                    </span>

                    {onDelete && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDelete();
                            }}
                            disabled={isUpdating}
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
                            <select
                                value={task.status}
                                onChange={(e) => handleStatusChange(e.target.value as Task["status"])}
                                disabled={isUpdating}
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

interface MobileTaskListProps {
    tasks: Task[];
    empty: string;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
    compact?: boolean;
}

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
        <div style={{ display: "grid", gap: isMobile ? "8px" : "12px" }}>
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

interface MobileQueueListProps {
    tasks: Task[];
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
}

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
            <div style={{ display: "grid", gap: "12px" }}>
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
