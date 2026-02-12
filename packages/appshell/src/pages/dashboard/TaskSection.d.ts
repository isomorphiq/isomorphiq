import type { Task } from "@isomorphiq/tasks/types";
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
    totalTaskCount: number;
    isLoading: boolean;
};
export declare function TaskSection({ isMobile, isAuthenticated, showCreateForm, onToggleCreate, tasks, onStatusChange, onPriorityChange, onDelete, totalTaskCount, isLoading, }: TaskSectionProps): import("react/jsx-runtime").JSX.Element;
export {};
