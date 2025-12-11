import type { Task } from "../../../../src/types.ts";
import { Hero } from "../../components/Hero.tsx";
import type { AuthState, DashboardTotals } from "../../hooks/useDashboardTasks.ts";
import type { OfflineTask } from "../../hooks/useOfflineSync.ts";
import { CreateTaskSection } from "./CreateTaskSection.tsx";
import { QueueSection } from "./QueueSection.tsx";
import { SummarySection } from "./SummarySection.tsx";
import { TaskSection } from "./TaskSection.tsx";

type DashboardViewProps = {
	auth: AuthState;
	isMobile: boolean;
	showCreateForm: boolean;
	onToggleCreate: () => void;
	onCreateSuccess: () => void;
	totals: DashboardTotals;
	queue: Array<Task | OfflineTask>;
	tasks: Array<Task | OfflineTask>;
	onStatusChange: (taskId: string, newStatus: Task["status"]) => void;
	onPriorityChange: (taskId: string, newPriority: Task["priority"]) => void;
	onDelete: (taskId: string) => void;
	isOnline: boolean;
	syncInProgress: boolean;
};

export function DashboardView({
	auth,
	isMobile,
	showCreateForm,
	onToggleCreate,
	onCreateSuccess,
	totals,
	queue,
	tasks,
	onStatusChange,
	onPriorityChange,
	onDelete,
	isOnline,
	syncInProgress,
}: DashboardViewProps) {
	return (
		<>
			<section style={{ marginBottom: "16px" }}>
				<Hero />
			</section>

			<CreateTaskSection
				isMobile={isMobile}
				isAuthenticated={auth.isAuthenticated}
				showCreateForm={showCreateForm}
				onToggle={onToggleCreate}
				onSuccess={onCreateSuccess}
			/>

			<SummarySection totals={totals} isOnline={isOnline} syncInProgress={syncInProgress} />
			<QueueSection
				isMobile={isMobile}
				tasks={queue}
				onStatusChange={onStatusChange}
				onPriorityChange={onPriorityChange}
				onDelete={onDelete}
			/>
			<TaskSection
				isMobile={isMobile}
				isAuthenticated={auth.isAuthenticated}
				showCreateForm={showCreateForm}
				onToggleCreate={onToggleCreate}
				tasks={tasks}
				onStatusChange={onStatusChange}
				onPriorityChange={onPriorityChange}
				onDelete={onDelete}
			/>
		</>
	);
}
