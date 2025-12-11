import { ResponsiveDashboard } from "../../components/ResponsiveDashboard.tsx";
import type { DashboardTotals } from "../../hooks/useDashboardTasks.ts";

type SummarySectionProps = {
	totals: DashboardTotals;
	isOnline: boolean;
	syncInProgress: boolean;
};

export function SummarySection({ totals, isOnline, syncInProgress }: SummarySectionProps) {
	return (
		<section style={{ marginBottom: "14px" }}>
			<ResponsiveDashboard
				totalTasks={totals.total}
				todoCount={totals.todo}
				inProgressCount={totals.inProgress}
				doneCount={totals.done}
				nextUp={totals.nextUp}
				isOnline={isOnline}
				syncInProgress={syncInProgress}
			/>
		</section>
	);
}
