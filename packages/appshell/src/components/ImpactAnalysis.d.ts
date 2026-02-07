import type { Task } from "@isomorphiq/tasks/types";
type ImpactAnalysisProps = {
    tasks: Task[];
    selectedTaskId?: string;
};
export declare function ImpactAnalysisComponent({ tasks, selectedTaskId }: ImpactAnalysisProps): import("react/jsx-runtime").JSX.Element;
export {};
