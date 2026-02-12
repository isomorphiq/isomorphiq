import type { Task } from "@isomorphiq/tasks/types";
import type { OfflineTask } from "../hooks/useOfflineSync.ts";
interface TaskCardProps {
    task: Task | OfflineTask;
    highlight?: boolean;
    showIndex?: number;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
}
export declare function TaskCard({ task, highlight, showIndex, onStatusChange, onPriorityChange, onDelete, }: TaskCardProps): import("react/jsx-runtime").JSX.Element;
interface TaskListProps {
    tasks: Array<Task | OfflineTask>;
    empty: string;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
}
export declare function TaskList({ tasks, empty, onStatusChange, onPriorityChange, onDelete, }: TaskListProps): import("react/jsx-runtime").JSX.Element;
interface QueueListProps {
    tasks: Array<Task | OfflineTask>;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
    remainingCount?: number;
    onLoadMore?: () => void;
    stacked?: boolean;
}
export declare function QueueList({ tasks, onStatusChange, onPriorityChange, onDelete, remainingCount, onLoadMore, stacked, }: QueueListProps): import("react/jsx-runtime").JSX.Element;
export {};
