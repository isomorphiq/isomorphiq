import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Task } from "../../../src/types.ts";
import { PriorityBadge } from "./PriorityBadge.tsx";
import { TypeBadge } from "./TypeBadge.tsx";

interface TaskCardProps {
    task: Task;
    highlight?: boolean;
    showIndex?: number;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
}

export function TaskCard({
    task,
    highlight = false,
    showIndex,
    onStatusChange,
    onPriorityChange,
    onDelete,
}: TaskCardProps) {
    const [isUpdating, setIsUpdating] = useState(false);

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

    return (
        <article
            style={{
                padding: "16px",
                borderRadius: "10px",
                border: highlight ? "2px solid #38bdf8" : "1px solid #1f2937",
                background: highlight ? "#0b1f33" : "#0b1220",
                position: "relative",
                opacity: isUpdating ? 0.6 : 1,
                boxShadow: highlight
                    ? "0 12px 28px rgba(56, 189, 248, 0.25)"
                    : "0 10px 20px rgba(0,0,0,0.25)",
            }}
        >
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
                        <span style={{ color: "#a5b4fc", fontWeight: 600, fontSize: "14px" }}>
                            {showIndex + 1}
                        </span>
                    )}
                    <TypeBadge type={task.type ?? "task"} />
                    <PriorityBadge priority={task.priority} />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span
                        style={{
                            fontSize: "12px",
                            color: statusColors[task.status],
                            fontWeight: "500",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            background: `${statusColors[task.status]}20`,
                        }}
                    >
                        {task.status.replace("-", " ")}
                    </span>

                    {onDelete && (
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={isUpdating}
                            style={{
                                background: "none",
                                border: "none",
                                color: "#ef4444",
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
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", color: "#f9fafb" }}>
                <Link to={`/tasks/${task.id}`} style={{ color: "#f9fafb", textDecoration: "none" }}>
                    {task.title}
                </Link>
            </h3>
            <p style={{ margin: "0 0 12px 0", color: "#cbd5e1", fontSize: "14px", lineHeight: "1.4" }}>
                {task.description}
            </p>

            {/* Actions */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                {onStatusChange && task.status !== "done" && (
                    <select
                        value={task.status}
                        onChange={(e) => handleStatusChange(e.target.value as Task["status"])}
                        disabled={isUpdating}
                        style={{
                            padding: "4px 8px",
                            borderRadius: "4px",
                            border: "1px solid #374151",
                            background: "#1f2937",
                            color: "#f9fafb",
                            fontSize: "12px",
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
                            padding: "4px 8px",
                            borderRadius: "4px",
                            border: "1px solid #374151",
                            background: "#1f2937",
                            color: "#f9fafb",
                            fontSize: "12px",
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
                        gap: "8px",
                        marginBottom: "8px",
                        fontSize: "12px",
                        color: "#94a3b8",
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
                            Assigned to: {task.assignedTo}
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
                        color: "#cbd5e1",
                    }}
                >
                    <span style={{ color: "#9ca3af", fontWeight: 600 }}>Depends on:</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {task.dependencies.map((dep) => (
                            <span
                                key={dep}
                                style={{
                                    background: "#1f2937",
                                    border: "1px solid #374151",
                                    borderRadius: "6px",
                                    padding: "4px 6px",
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
                    color: "#64748b",
                    fontSize: "11px",
                    borderTop: "1px solid #1f2937",
                    paddingTop: "8px",
                    gap: "8px",
                }}
            >
                <span>Created: {new Date(task.createdAt).toLocaleDateString()}</span>
                <span>Updated: {new Date(task.updatedAt).toLocaleDateString()}</span>
                <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>ID: {task.id}</span>
            </div>
        </article>
    );
}

interface TaskListProps {
    tasks: Task[];
    empty: string;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
}

export function TaskList({
    tasks,
    empty,
    onStatusChange,
    onPriorityChange,
    onDelete,
}: TaskListProps) {
    if (!tasks.length) return <p style={{ color: "#94a3b8", margin: 0 }}>{empty}</p>;
    return (
        <div
            style={{
                display: "grid",
                gap: "12px",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            }}
        >
            {tasks.map((task) => (
                <TaskCard
                    key={task.id}
                    task={task}
                    onStatusChange={onStatusChange}
                    onPriorityChange={onPriorityChange}
                    onDelete={onDelete}
                />
            ))}
        </div>
    );
}

interface QueueListProps {
    tasks: Task[];
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
    remainingCount?: number;
    onLoadMore?: () => void;
    stacked?: boolean;
}

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

    if (!tasks.length) return <p style={{ color: "#94a3b8", margin: 0 }}>Queue is empty.</p>;

    const renderLoadMore = () =>
        remainingCount > 0 && onLoadMore ? (
            <div
                style={{
                    minWidth: stacked ? "auto" : "300px",
                    maxWidth: stacked ? "none" : "320px",
                    flex: stacked ? "1 1 100%" : "0 0 auto",
                    display: "flex",
                    alignItems: "stretch",
                    marginTop: "4px",
                }}
            >
                <button
                    type="button"
                    onClick={onLoadMore}
                    style={{
                        width: "100%",
                        padding: stacked ? "12px" : "16px",
                        borderRadius: "10px",
                        border: "1px dashed #374151",
                        background: "#0b1220",
                        color: "#e5e7eb",
                        fontSize: "14px",
                        fontWeight: 600,
                        cursor: "pointer",
                        textAlign: "center",
                        boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
                    }}
                >
                    Load more ({remainingCount} remaining)
                </button>
            </div>
        ) : null;

    if (stacked) {
        return (
            <div style={{ display: "grid", gap: "12px" }}>
                {ordered.map((task, idx) => (
                    <TaskCard
                        key={task.id}
                        task={task}
                        highlight={idx === ordered.length - 1}
                        showIndex={ordered.length - 1 - idx}
                        onStatusChange={onStatusChange}
                        onPriorityChange={onPriorityChange}
                        onDelete={onDelete}
                    />
                ))}
                {renderLoadMore()}
            </div>
        );
    }

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
                    paddingLeft: "min(40px, 10vw)", // give some leading space so items can sit to the right
                    justifyContent: "flex-start",
                }}
            >
                {renderLoadMore()}
                {/* render so the rightmost item is the highest priority (original first) */}
                {ordered.map((task, idx) => (
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
                        <TaskCard
                            task={task}
                            highlight={idx === ordered.length - 1}
                            showIndex={ordered.length - 1 - idx}
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
