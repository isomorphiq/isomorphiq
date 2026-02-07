// FILE_CONTEXT: "context-15f5d232-0f4d-475a-9a1d-c32e29791ec3"

import { ResponsiveDashboard } from "../../components/ResponsiveDashboard.tsx";
import type { DashboardTotals } from "../../hooks/useDashboardTasks.ts";

type SummarySectionProps = {
    totals: DashboardTotals;
    isOnline: boolean;
    syncInProgress: boolean;
    isLoading: boolean;
    onQuickNewTask?: () => Promise<void> | void;
    onQuickRefresh?: () => Promise<void> | void;
    onQuickSearch?: () => Promise<void> | void;
    onQuickAnalytics?: () => Promise<void> | void;
};

export function SummarySection({
    totals,
    isOnline,
    syncInProgress,
    isLoading,
    onQuickNewTask,
    onQuickRefresh,
    onQuickSearch,
    onQuickAnalytics,
}: SummarySectionProps) {
    return (
        <div style={{ marginBottom: "14px" }}>
            <ResponsiveDashboard
                totalTasks={totals.total}
                todoCount={totals.todo}
                inProgressCount={totals.inProgress}
                doneCount={totals.done}
                nextUp={totals.nextUp}
                isOnline={isOnline}
                syncInProgress={syncInProgress}
                isLoading={isLoading}
                onQuickNewTask={onQuickNewTask}
                onQuickRefresh={onQuickRefresh}
                onQuickSearch={onQuickSearch}
                onQuickAnalytics={onQuickAnalytics}
            />
        </div>
    );
}
