import { useState } from "react";
import { Header, Layout } from "../components/Layout.tsx";
import { PWAInstallPrompt } from "../components/PWAInstallPrompt.tsx";
import { EnhancedErrorBoundary } from "../components/UIComponents.tsx";
import { useDashboardTasks } from "../hooks/useDashboardTasks.ts";
import { useIsMobile } from "../hooks/useIsMobile.ts";
import { DashboardView } from "./dashboard/DashboardView.tsx";

export function DashboardPage() {
    const {
        auth,
        mergedFilteredTasks,
        mergedQueue,
        totals,
        isOnline,
        syncInProgress,
        handleStatusChange,
        handlePriorityChange,
        handleDelete,
        refresh,
    } = useDashboardTasks();
    const [showCreateForm, setShowCreateForm] = useState(false);
    const isMobile = useIsMobile();

    return (
        <EnhancedErrorBoundary>
            <Layout>
                {!isMobile && <Header title="" showAuthControls={false} />}

                <DashboardView
                    auth={auth}
                    isMobile={isMobile}
                    showCreateForm={showCreateForm}
                    onToggleCreate={() => setShowCreateForm((value) => !value)}
                    onCreateSuccess={refresh}
                    totals={totals}
                    queue={mergedQueue}
                    tasks={mergedFilteredTasks}
                    onStatusChange={handleStatusChange}
                    onPriorityChange={handlePriorityChange}
                    onDelete={handleDelete}
                    isOnline={isOnline}
                    syncInProgress={syncInProgress}
                />
            </Layout>

            <PWAInstallPrompt />
        </EnhancedErrorBoundary>
    );
}
