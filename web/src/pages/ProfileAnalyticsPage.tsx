import { Header, Layout } from "../components/Layout.tsx";
import { MobileLayout } from "../components/MobileLayout.tsx";
import { ProfileAnalytics } from "../components/ProfileAnalytics.tsx";
import { PWAInstallPrompt } from "../components/PWAInstallPrompt.tsx";
import { EnhancedErrorBoundary } from "../components/UIComponents.tsx";
import { useIsMobile } from "../hooks/useIsMobile.ts";

export function ProfileAnalyticsPage() {
    const isMobile = useIsMobile();
    const LayoutComponent = isMobile ? MobileLayout : Layout;

    return (
        <EnhancedErrorBoundary>
            <LayoutComponent>
                {!isMobile && <Header title="Profile Analytics" showAuthControls={false} />}
                <section>
                    <ProfileAnalytics />
                </section>
            </LayoutComponent>
            <PWAInstallPrompt />
        </EnhancedErrorBoundary>
    );
}
