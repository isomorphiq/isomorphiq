import { Header, Layout } from "../components/Layout.tsx";
import { ProfileManagement } from "../components/ProfileManagement.tsx";
import { PWAInstallPrompt } from "../components/PWAInstallPrompt.tsx";
import { EnhancedErrorBoundary } from "../components/UIComponents.tsx";

export function ProfilesPage() {
    return (
        <EnhancedErrorBoundary>
            <Layout>
                <Header title="Profiles" showAuthControls={false} />
                <section>
                    <ProfileManagement />
                </section>
            </Layout>
            <PWAInstallPrompt />
        </EnhancedErrorBoundary>
    );
}
