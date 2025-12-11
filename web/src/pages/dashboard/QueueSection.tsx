import { useEffect, useMemo, useState } from "react";
import type { Task } from "../../../../src/types.ts";
import { MobileQueueList } from "../../components/MobileTaskCard.tsx";
import { SectionCard } from "../../components/SectionCard.tsx";
import { QueueList } from "../../components/TaskCard.tsx";
import type { OfflineTask } from "../../hooks/useOfflineSync.ts";

type QueueSectionProps = {
    isMobile: boolean;
    tasks: Array<Task | OfflineTask>;
    onStatusChange: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete: (taskId: string) => void;
};

export function QueueSection({
    isMobile,
    tasks,
    onStatusChange,
    onPriorityChange,
    onDelete,
}: QueueSectionProps) {
    const PAGE_SIZE = 8;
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

    useEffect(() => {
        setVisibleCount((current) => Math.min(current, Math.max(PAGE_SIZE, tasks.length)));
    }, [tasks.length]);

    const visibleTasks = useMemo(
        () => tasks.slice(0, visibleCount),
        [tasks, visibleCount],
    );

    const handleLoadMore = () => {
        setVisibleCount((current) => Math.min(tasks.length, current + PAGE_SIZE));
    };

    const renderLoadMore = () =>
        tasks.length > visibleTasks.length ? (
            <div style={{ display: "flex", justifyContent: "center", marginTop: "12px" }}>
                <button
                    type="button"
                    onClick={handleLoadMore}
                    style={{
                        padding: "10px 16px",
                        borderRadius: "8px",
                        border: "1px solid #1f2937",
                        background: "#1f2937",
                        color: "#e5e7eb",
                        fontSize: "13px",
                        cursor: "pointer",
                    }}
                >
                    Load more ({tasks.length - visibleTasks.length} remaining)
                </button>
            </div>
        ) : null;

    if (isMobile) {
        return (
            <section style={{ marginBottom: "16px" }}>
                <div
                    style={{
                        background: "#0b1220",
                        borderRadius: "12px",
                        border: "1px solid #1f2937",
                        padding: "16px",
                        boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
                    }}
                >
                    <h3
                        style={{
                            margin: "0 0 12px 0",
                            color: "#f9fafb",
                            fontSize: "16px",
                            fontWeight: 600,
                        }}
                    >
                        Next Up ({tasks.length} queued)
                    </h3>
                    <MobileQueueList
                        tasks={visibleTasks}
                        onStatusChange={onStatusChange}
                        onPriorityChange={onPriorityChange}
                        onDelete={onDelete}
                    />
                    {renderLoadMore()}
                </div>
            </section>
        );
    }

    return (
        <section style={{ marginBottom: "16px" }}>
            <SectionCard title="Next Up" countLabel={`${tasks.length} queued`}>
                <QueueList
                    tasks={visibleTasks}
                    onStatusChange={onStatusChange}
                    onPriorityChange={onPriorityChange}
                    onDelete={onDelete}
                    remainingCount={tasks.length - visibleTasks.length}
                    onLoadMore={handleLoadMore}
                />
            </SectionCard>
        </section>
    );
}
