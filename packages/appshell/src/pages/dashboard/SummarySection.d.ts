import type { DashboardTotals } from "../../hooks/useDashboardTasks.ts";
type SummarySectionProps = {
    totals: DashboardTotals;
    isOnline: boolean;
    syncInProgress: boolean;
    isLoading: boolean;
};
export declare function SummarySection({ totals, isOnline, syncInProgress, isLoading }: SummarySectionProps): import("react/jsx-runtime").JSX.Element;
export {};
