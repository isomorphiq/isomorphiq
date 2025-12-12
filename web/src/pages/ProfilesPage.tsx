import { Header, Layout } from "../components/Layout.tsx";
import { MobileLayout } from "../components/MobileLayout.tsx";
import { ProfileManagement } from "../components/ProfileManagement.tsx";
import { PWAInstallPrompt } from "../components/PWAInstallPrompt.tsx";
import { EnhancedErrorBoundary } from "../components/UIComponents.tsx";
import { useIsMobile } from "../hooks/useIsMobile.ts";

export function ProfilesPage() {
    const isMobile = useIsMobile();
    const LayoutComponent = isMobile ? MobileLayout : Layout;

    return (
        <EnhancedErrorBoundary>
            <LayoutComponent>
                {!isMobile && <Header title="Profiles" showAuthControls={false} />}
                <section>
                    <ProfileManagement />
                </section>
            </LayoutComponent>
            <PWAInstallPrompt />
        </EnhancedErrorBoundary>
    );
}
