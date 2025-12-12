import { Header, Layout } from "../components/Layout.tsx";
import { MobileLayout } from "../components/MobileLayout.tsx";
import { PWAInstallPrompt } from "../components/PWAInstallPrompt.tsx";
import { RealTimeActivityFeed } from "../components/RealTimeActivityFeed.tsx";
import { EnhancedErrorBoundary } from "../components/UIComponents.tsx";
import { useIsMobile } from "../hooks/useIsMobile.ts";

export function ActivityPage() {
    const isMobile = useIsMobile();
    const LayoutComponent = isMobile ? MobileLayout : Layout;

    return (
        <EnhancedErrorBoundary>
            <LayoutComponent>
                {!isMobile && <Header title="Activity" showAuthControls={false} />}
                <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    <RealTimeActivityFeed />
                </section>
            </LayoutComponent>
            <PWAInstallPrompt />
        </EnhancedErrorBoundary>
    );
}
