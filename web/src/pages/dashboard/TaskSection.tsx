import { useEffect, useMemo, useState } from "react";
import type { Task } from "../../../../src/types.ts";
import { LegendBand } from "../../components/Band.tsx";
import { MobileTaskList } from "../../components/MobileTaskCard.tsx";
import { SearchAndFilter } from "../../components/SearchAndFilter.tsx";
import { SectionCard } from "../../components/SectionCard.tsx";
import { TaskList } from "../../components/TaskCard.tsx";
import type { OfflineTask } from "../../hooks/useOfflineSync.ts";

type TaskSectionProps = {
    isMobile: boolean;
    isAuthenticated: boolean;
    showCreateForm: boolean;
    onToggleCreate: () => void;
    tasks: Array<Task | OfflineTask>;
    onStatusChange: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete: (taskId: string) => void;
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
}: TaskSectionProps) {
    const [page, setPage] = useState(1);

    const PAGE_SIZE = 8;

    const pageCount = useMemo(
        () => Math.max(1, Math.ceil(tasks.length / PAGE_SIZE)),
        [tasks.length],
    );

    useEffect(() => {
        setPage((current) => Math.min(current, pageCount));
    }, [pageCount]);

    const visibleTasks = useMemo(
        () => tasks.slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE),
        [page, tasks],
    );

    const goToPrevious = () => {
        setPage((current) => Math.max(1, current - 1));
    };

    const goToNext = () => {
        setPage((current) => Math.min(pageCount, current + 1));
    };

    const renderPagination = () => (
        <div
            style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "8px",
                margin: "12px 0",
                flexWrap: "wrap",
            }}
        >
            <span style={{ color: "#94a3b8", fontSize: "12px" }}>
                Showing {visibleTasks.length} of {tasks.length} tasks
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                    type="button"
                    onClick={goToPrevious}
                    disabled={page === 1}
                    style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #1f2937",
                        background: page === 1 ? "#0b1220" : "#1f2937",
                        color: "#e5e7eb",
                        cursor: page === 1 ? "not-allowed" : "pointer",
                        fontSize: "12px",
                        minWidth: "90px",
                    }}
                >
                    Previous
                </button>
                <span style={{ color: "#cbd5e1", fontSize: "12px", minWidth: "90px", textAlign: "center" }}>
                    Page {page} of {pageCount}
                </span>
                <button
                    type="button"
                    onClick={goToNext}
                    disabled={page === pageCount || tasks.length === 0}
                    style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #1f2937",
                        background: page === pageCount || tasks.length === 0 ? "#0b1220" : "#1f2937",
                        color: "#e5e7eb",
                        cursor:
                            page === pageCount || tasks.length === 0 ? "not-allowed" : "pointer",
                        fontSize: "12px",
                        minWidth: "90px",
                    }}
                >
                    Next
                </button>
            </div>
        </div>
    );

    if (isMobile) {
        return (
            <section>
                <div
                    style={{
                        background: "#0b1220",
                        borderRadius: "12px",
                        border: "1px solid #1f2937",
                        padding: "16px",
                        boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
                    }}
                >
                    <section
                        style={{
                            marginBottom: "16px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "12px",
                        }}
                    >
                        <div style={{ flex: 1 }}>
                            <SearchAndFilter />
                        </div>
                        {isAuthenticated && (
                            <button
                                type="button"
                                onClick={onToggleCreate}
                                style={{
                                    padding: "12px 16px",
                                    borderRadius: "8px",
                                    border: "none",
                                    background: "#3b82f6",
                                    color: "white",
                                    fontSize: "14px",
                                    fontWeight: "600",
                                    cursor: "pointer",
                                    width: "100%",
                                    justifyContent: "center",
                                }}
                            >
                                {showCreateForm ? "Cancel" : "+ Create Task"}
                            </button>
                        )}
                    </section>
                    <LegendBand />
                    {renderPagination()}
                    <MobileTaskList
                        tasks={visibleTasks}
                        empty="No tasks match your filters."
                        onStatusChange={onStatusChange}
                        onPriorityChange={onPriorityChange}
                        onDelete={onDelete}
                    />
                    {renderPagination()}
                </div>
            </section>
        );
    }

    return (
        <section>
            <SectionCard
                title="All Tasks"
                countLabel={`${visibleTasks.length} of ${tasks.length} shown`}
            >
                <section
                    style={{
                        marginBottom: "16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
                    <div style={{ flex: 1 }}>
                        <SearchAndFilter />
                    </div>
                    {isAuthenticated && (
                        <button
                            type="button"
                            onClick={onToggleCreate}
                            style={{
                                padding: "10px 20px",
                                borderRadius: "8px",
                                border: "none",
                                background: "#3b82f6",
                                color: "white",
                                fontSize: "14px",
                                fontWeight: "500",
                                cursor: "pointer",
                                marginLeft: "16px",
                            }}
                        >
                            {showCreateForm ? "Cancel" : "+ Create Task"}
                        </button>
                    )}
                </section>
                <LegendBand />
                {renderPagination()}
                <TaskList
                    tasks={visibleTasks}
                    empty="No tasks match your filters."
                    onStatusChange={onStatusChange}
                    onPriorityChange={onPriorityChange}
                    onDelete={onDelete}
                />
                {renderPagination()}
            </SectionCard>
        </section>
    );
}
