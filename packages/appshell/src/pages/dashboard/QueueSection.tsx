import { useEffect, useMemo, useState } from "react";
import type { Task } from "@isomorphiq/tasks/types";
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
                    stacked={isMobile}
                />
            </SectionCard>
        </section>
    );
}
