// FILE_CONTEXT: "context-20f5bd89-44b0-4217-bf82-e305036e1707"

import { useEffect, useMemo, useState } from "react";
import type { Task } from "@isomorphiq/tasks/types";
import { SectionCard } from "../../components/SectionCard.tsx";
import { QueueList } from "../../components/TaskCard.tsx";
import { LoadingSpinner } from "../../components/UIComponents.tsx";
import type { OfflineTask } from "../../hooks/useOfflineSync.ts";

type QueueSectionProps = {
    isMobile: boolean;
    tasks: Array<Task | OfflineTask>;
    onStatusChange: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete: (taskId: string) => void;
    isLoading: boolean;
};

export function QueueSection({
    isMobile,
    tasks,
    onStatusChange,
    onPriorityChange,
    onDelete,
    isLoading,
}: QueueSectionProps) {
    const PAGE_SIZE = 8;
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const showLoadingState = isLoading && tasks.length === 0;

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

    return (
        <section style={{ marginBottom: "16px" }}>
            <SectionCard
                title="Next Up"
                countLabel={showLoadingState ? "Loading queue..." : `${tasks.length} queued`}
            >
                {showLoadingState ? (
                    <div style={{ padding: "24px 0", display: "flex", justifyContent: "center" }}>
                        <LoadingSpinner message="Loading queue..." />
                    </div>
                ) : (
                    <QueueList
                        tasks={visibleTasks}
                        onStatusChange={onStatusChange}
                        onPriorityChange={onPriorityChange}
                        onDelete={onDelete}
                        remainingCount={tasks.length - visibleTasks.length}
                        onLoadMore={handleLoadMore}
                        stacked={isMobile}
                    />
                )}
            </SectionCard>
        </section>
    );
}
