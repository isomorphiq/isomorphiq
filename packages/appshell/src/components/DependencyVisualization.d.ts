import type { Task } from "@isomorphiq/tasks/types";
type DependencyVisualizationProps = {
    tasks: Task[];
    width?: number;
    height?: number;
    onTaskClick?: (task: Task) => void;
    onTaskHover?: (task: Task | null) => void;
    selectedTaskId?: string;
};
export declare function DependencyVisualization({ tasks, width, height, onTaskClick, onTaskHover, selectedTaskId, }: DependencyVisualizationProps): import("react/jsx-runtime").JSX.Element;
export {};
