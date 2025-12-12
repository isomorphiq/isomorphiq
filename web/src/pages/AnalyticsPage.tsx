import { Header, Layout } from "../components/Layout.tsx";
import { MobileLayout } from "../components/MobileLayout.tsx";
import { PWAInstallPrompt } from "../components/PWAInstallPrompt.tsx";
import { EnhancedErrorBoundary } from "../components/UIComponents.tsx";
import { AnalyticsDashboard } from "../components/AnalyticsDashboard.tsx";
import { useDashboardTasks } from "../hooks/useDashboardTasks.ts";
import { useIsMobile } from "../hooks/useIsMobile.ts";

export function AnalyticsPage() {
    const { allTasks } = useDashboardTasks();
    const isMobile = useIsMobile();
    const LayoutComponent = isMobile ? MobileLayout : Layout;

    return (
        <EnhancedErrorBoundary>
            <LayoutComponent>
                {!isMobile && <Header title="Analytics" showAuthControls={false} />}
                <section>
                    <AnalyticsDashboard _tasks={allTasks} />
                </section>
            </LayoutComponent>
            <PWAInstallPrompt />
        </EnhancedErrorBoundary>
    );
}
