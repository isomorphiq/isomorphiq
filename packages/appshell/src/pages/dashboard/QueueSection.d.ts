import type { Task } from "@isomorphiq/tasks/types";
import type { OfflineTask } from "../../hooks/useOfflineSync.ts";
type QueueSectionProps = {
    isMobile: boolean;
    tasks: Array<Task | OfflineTask>;
    onStatusChange: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete: (taskId: string) => void;
    isLoading: boolean;
};
export declare function QueueSection({ isMobile, tasks, onStatusChange, onPriorityChange, onDelete, isLoading, }: QueueSectionProps): import("react/jsx-runtime").JSX.Element;
export {};
