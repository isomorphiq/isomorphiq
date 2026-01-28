import { Header, Layout } from "../components/Layout.tsx";
import { ProfileAnalytics } from "../components/ProfileAnalytics.tsx";
import { PWAInstallPrompt } from "../components/PWAInstallPrompt.tsx";
import { EnhancedErrorBoundary } from "../components/UIComponents.tsx";

export function ProfileAnalyticsPage() {
    return (
        <EnhancedErrorBoundary>
            <Layout>
                <Header title="Profile Analytics" showAuthControls={false} />
                <section>
                    <ProfileAnalytics />
                </section>
            </Layout>
            <PWAInstallPrompt />
        </EnhancedErrorBoundary>
    );
}
