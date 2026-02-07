// FILE_CONTEXT: "context-0ecfd069-a64f-423c-8b30-d39e0ae033f2"

import { useEffect, useMemo, useRef, useState } from "react";
import type { Task } from "@isomorphiq/tasks/types";
import { LegendBand } from "../../components/Band.tsx";
import { SearchAndFilter } from "../../components/SearchAndFilter.tsx";
import { SectionCard } from "../../components/SectionCard.tsx";
import { TaskList } from "../../components/TaskCard.tsx";
import { LoadingSpinner } from "../../components/UIComponents.tsx";
import type { OfflineTask } from "../../hooks/useOfflineSync.ts";

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

type TaskSectionProps = {
    isMobile: boolean;
    isAuthenticated: boolean;
    showCreateForm: boolean;
    onToggleCreate: () => void;
    tasks: Array<Task | OfflineTask>;
    onStatusChange: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete: (taskId: string) => void;
    totalTaskCount: number;
    isLoading: boolean;
};

export function TaskSection({
    isMobile,
    isAuthenticated,
    showCreateForm,
    onToggleCreate,
    tasks,
    onStatusChange,
    onPriorityChange,
    onDelete,
    totalTaskCount,
    isLoading,
}: TaskSectionProps) {
    const [page, setPage] = useState(1);
    const [taskAnnouncement, setTaskAnnouncement] = useState("");
    const hasMountedRef = useRef(false);
    const lastAnnouncementRef = useRef("");

    const PAGE_SIZE = 8;
    const showLoadingState = isLoading && tasks.length === 0;
    const showPagination = !showLoadingState && tasks.length > 0;
    const emptyMessage =
        totalTaskCount === 0 ? "No tasks yet - create your first one!" : "No tasks match your filters.";

    const pageCount = useMemo(
        () => Math.max(1, Math.ceil(tasks.length / PAGE_SIZE)),
        [tasks.length],
    );

    const visibleTasks = useMemo(
        () => tasks.slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE),
        [page, tasks],
    );

    useEffect(() => {
        setPage((current) => Math.min(current, pageCount));
    }, [pageCount]);

    useEffect(() => {
        if (showLoadingState) {
            setTaskAnnouncement("");
            return;
        }
        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            return;
        }
        const nextMessage =
            tasks.length === 0
                ? emptyMessage
                : `Showing ${visibleTasks.length} of ${tasks.length} tasks. Page ${page} of ${pageCount}.`;

        if (nextMessage === lastAnnouncementRef.current) {
            return;
        }

        const timeout = setTimeout(() => {
            lastAnnouncementRef.current = nextMessage;
            setTaskAnnouncement(nextMessage);
        }, 160);

        return () => clearTimeout(timeout);
    }, [showLoadingState, tasks.length, visibleTasks.length, page, pageCount, emptyMessage]);

    useEffect(() => {
        if (!isAuthenticated) {
            return;
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
                return;
            }
            if (event.key.toLowerCase() !== "n") {
                return;
            }
            if (isEditableTarget(event.target)) {
                return;
            }
            if (!showCreateForm) {
                event.preventDefault();
                onToggleCreate();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isAuthenticated, onToggleCreate, showCreateForm]);

    const goToPrevious = () => {
        setPage((current) => Math.max(1, current - 1));
    };

    const goToNext = () => {
        setPage((current) => Math.min(pageCount, current + 1));
    };

    const renderPagination = () => (
        <div
            role="group"
            aria-label="Task pagination"
            style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "8px",
                margin: "12px 0",
                flexWrap: "wrap",
            }}
        >
            <span style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>
                Showing {visibleTasks.length} of {tasks.length} tasks
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                    type="button"
                    onClick={goToPrevious}
                    disabled={page === 1}
                    aria-label="Previous page"
                    style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border-secondary)",
                        background:
                            page === 1 ? "var(--color-surface-tertiary)" : "var(--color-surface-secondary)",
                        color: "var(--color-text-primary)",
                        cursor: page === 1 ? "not-allowed" : "pointer",
                        fontSize: "12px",
                        minWidth: "90px",
                        opacity: page === 1 ? 0.7 : 1,
                    }}
                >
                    Previous
                </button>
                <span
                    style={{
                        color: "var(--color-text-secondary)",
                        fontSize: "12px",
                        minWidth: "90px",
                        textAlign: "center",
                    }}
                >
                    Page {page} of {pageCount}
                </span>
                <button
                    type="button"
                    onClick={goToNext}
                    disabled={page === pageCount || tasks.length === 0}
                    aria-label="Next page"
                    style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--color-border-secondary)",
                        background:
                            page === pageCount || tasks.length === 0
                                ? "var(--color-surface-tertiary)"
                                : "var(--color-surface-secondary)",
                        color: "var(--color-text-primary)",
                        cursor:
                            page === pageCount || tasks.length === 0 ? "not-allowed" : "pointer",
                        fontSize: "12px",
                        minWidth: "90px",
                        opacity: page === pageCount || tasks.length === 0 ? 0.7 : 1,
                    }}
                >
                    Next
                </button>
            </div>
        </div>
    );

    return (
        <div>
            <SectionCard
                title="All Tasks"
                countLabel={showLoadingState ? "Loading tasks..." : `${visibleTasks.length} of ${tasks.length} shown`}
            >
                <div role="status" aria-live="polite" aria-atomic="true" style={visuallyHiddenStyle}>
                    {taskAnnouncement}
                </div>
                <section
                    style={{
                        marginBottom: "16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: isMobile ? "stretch" : "center",
                        gap: "12px",
                        flexWrap: "wrap",
                    }}
                >
                    <div style={{ flex: "1 1 260px" }}>
                        <SearchAndFilter />
                    </div>
                    {isAuthenticated && (
                        <button
                            type="button"
                            onClick={onToggleCreate}
                            aria-expanded={showCreateForm}
                            aria-controls="dashboard-create-task"
                            aria-label={showCreateForm ? "Close create task form" : "Open create task form"}
                            aria-keyshortcuts="N"
                            style={{
                                padding: isMobile ? "12px" : "10px 20px",
                                borderRadius: "8px",
                                border: "none",
                                background: "var(--color-accent-primary)",
                                color: "var(--color-text-on-accent)",
                                fontSize: "14px",
                                fontWeight: "600",
                                cursor: "pointer",
                                minWidth: isMobile ? "100%" : "140px",
                                alignSelf: isMobile ? "stretch" : "center",
                            }}
                            title="Shortcut: N"
                        >
                            {showCreateForm ? "Cancel" : "+ Create Task"}
                        </button>
                    )}
                </section>
                <LegendBand />
                {showLoadingState ? (
                    <div style={{ padding: "28px 0", display: "flex", justifyContent: "center" }}>
                        <LoadingSpinner message="Loading tasks..." />
                    </div>
                ) : (
                    <>
                        {showPagination && renderPagination()}
                        <TaskList
                            tasks={visibleTasks}
                            empty={emptyMessage}
                            onStatusChange={onStatusChange}
                            onPriorityChange={onPriorityChange}
                            onDelete={onDelete}
                        />
                        {showPagination && renderPagination()}
                    </>
                )}
            </SectionCard>
        </div>
    );
}
