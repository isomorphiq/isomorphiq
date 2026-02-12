interface ResponsiveDashboardProps {
    totalTasks: number;
    todoCount: number;
    inProgressCount: number;
    doneCount: number;
    nextUp?: {
        title?: string;
    } | null;
    isOnline: boolean;
    syncInProgress: boolean;
    isLoading: boolean;
}
export declare function ResponsiveDashboard({ totalTasks, todoCount, inProgressCount, doneCount, nextUp, isOnline, syncInProgress, isLoading, }: ResponsiveDashboardProps): import("react/jsx-runtime").JSX.Element;
export {};
