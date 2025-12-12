import { Header, Layout } from "../components/Layout.tsx";
import { PWAInstallPrompt } from "../components/PWAInstallPrompt.tsx";
import { EnhancedErrorBoundary } from "../components/UIComponents.tsx";
import { AnalyticsDashboard } from "../components/AnalyticsDashboard.tsx";
import { useDashboardTasks } from "../hooks/useDashboardTasks.ts";

export function AnalyticsPage() {
    const { allTasks } = useDashboardTasks();

    return (
        <EnhancedErrorBoundary>
            <Layout>
                <Header title="Analytics" showAuthControls={false} />
                <section>
                    <AnalyticsDashboard _tasks={allTasks} />
                </section>
            </Layout>
            <PWAInstallPrompt />
        </EnhancedErrorBoundary>
    );
}
