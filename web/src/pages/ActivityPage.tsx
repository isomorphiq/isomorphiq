import { Header, Layout } from "../components/Layout.tsx";
import { PWAInstallPrompt } from "../components/PWAInstallPrompt.tsx";
import { RealTimeActivityFeed } from "../components/RealTimeActivityFeed.tsx";
import { EnhancedErrorBoundary } from "../components/UIComponents.tsx";

export function ActivityPage() {
    return (
        <EnhancedErrorBoundary>
            <Layout>
                <Header title="Activity" showAuthControls={false} />
                <section
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                        gap: "16px",
                    }}
                >
                    <RealTimeActivityFeed />
                </section>
            </Layout>
            <PWAInstallPrompt />
        </EnhancedErrorBoundary>
    );
}
