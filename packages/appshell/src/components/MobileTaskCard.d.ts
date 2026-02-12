import type { Task } from "@isomorphiq/tasks/types";
interface MobileTaskCardProps {
    task: Task & {
        isOffline?: boolean;
    };
    highlight?: boolean;
    showIndex?: number;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
    compact?: boolean;
}
export declare function MobileTaskCard({ task, highlight, showIndex, onStatusChange, onPriorityChange, onDelete, compact, }: MobileTaskCardProps): import("react/jsx-runtime").JSX.Element;
interface MobileTaskListProps {
    tasks: Task[];
    empty: string;
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
    compact?: boolean;
}
export declare function MobileTaskList({ tasks, empty, onStatusChange, onPriorityChange, onDelete, compact, }: MobileTaskListProps): import("react/jsx-runtime").JSX.Element;
interface MobileQueueListProps {
    tasks: Task[];
    onStatusChange?: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange?: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete?: (taskId: string) => void;
}
export declare function MobileQueueList({ tasks, onStatusChange, onPriorityChange, onDelete, }: MobileQueueListProps): import("react/jsx-runtime").JSX.Element;
export {};
