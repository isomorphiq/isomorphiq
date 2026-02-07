// FILE_CONTEXT: "context-bec63427-b209-417c-8863-531fef0ae04c"

import type { Task } from "@isomorphiq/tasks/types";
import { FeedbackToastProvider } from "../../components/ActionFeedback.tsx";
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
    onQuickNewTask?: () => Promise<void> | void;
    onQuickRefresh?: () => Promise<void> | void;
    onQuickSearch?: () => Promise<void> | void;
    onQuickAnalytics?: () => Promise<void> | void;
    totals: DashboardTotals;
    totalTaskCount: number;
    queue: Array<Task | OfflineTask>;
    tasks: Array<Task | OfflineTask>;
    onStatusChange: (taskId: string, newStatus: Task["status"]) => void;
    onPriorityChange: (taskId: string, newPriority: Task["priority"]) => void;
    onDelete: (taskId: string) => void;
    isLoading: boolean;
    isOnline: boolean;
    syncInProgress: boolean;
};

export function DashboardView({
    auth,
    isMobile,
    showCreateForm,
    onToggleCreate,
    onCreateSuccess,
    onQuickNewTask,
    onQuickRefresh,
    onQuickSearch,
    onQuickAnalytics,
    totals,
    totalTaskCount,
    queue,
    tasks,
    onStatusChange,
    onPriorityChange,
    onDelete,
    isLoading,
    isOnline,
    syncInProgress,
}: DashboardViewProps) {
    return (
        <FeedbackToastProvider>
            <div style={{ marginBottom: "16px" }}>
                <Hero />
            </div>

            <CreateTaskSection
                isAuthenticated={auth.isAuthenticated}
                showCreateForm={showCreateForm}
                onToggle={onToggleCreate}
                onSuccess={onCreateSuccess}
            />

            <SummarySection
                totals={totals}
                isOnline={isOnline}
                syncInProgress={syncInProgress}
                isLoading={isLoading}
                onQuickNewTask={onQuickNewTask}
                onQuickRefresh={onQuickRefresh}
                onQuickSearch={onQuickSearch}
                onQuickAnalytics={onQuickAnalytics}
            />
            <QueueSection
                isMobile={isMobile}
                tasks={queue}
                onStatusChange={onStatusChange}
                onPriorityChange={onPriorityChange}
                onDelete={onDelete}
                isLoading={isLoading}
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
                totalTaskCount={totalTaskCount}
                isLoading={isLoading}
            />
        </FeedbackToastProvider>
    );
}
