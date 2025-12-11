import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnalyticsDashboard } from "../components/AnalyticsDashboard.tsx";
import { Header, Layout } from "../components/Layout.tsx";
import { MobileLayout } from "../components/MobileLayout.tsx";
import { ProfileAnalytics } from "../components/ProfileAnalytics.tsx";
import { ProfileManagement } from "../components/ProfileManagement.tsx";
import { PWAInstallPrompt } from "../components/PWAInstallPrompt.tsx";
import { RealTimeActivityFeed } from "../components/RealTimeActivityFeed.tsx";
import { EnhancedErrorBoundary } from "../components/UIComponents.tsx";
import { useDashboardTasks } from "../hooks/useDashboardTasks.ts";
import { useIsMobile } from "../hooks/useIsMobile.ts";
import { DashboardView } from "./dashboard/DashboardView.tsx";

type DashboardViewKey = "dashboard" | "analytics" | "activity" | "profiles" | "profile-analytics";

export function DashboardPage({ initialView = "dashboard" }: { initialView?: DashboardViewKey }) {
	const {
		auth,
		allTasks,
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
	const location = useLocation();
	const activeView = useMemo<DashboardViewKey>(() => {
		switch (location.pathname) {
			case "/analytics":
				return "analytics";
			case "/activity":
				return "activity";
			case "/profiles":
				return "profiles";
			case "/profile-analytics":
				return "profile-analytics";
			default:
				return initialView;
		}
	}, [initialView, location.pathname]);
	const LayoutComponent = isMobile ? MobileLayout : Layout;

	return (
		<EnhancedErrorBoundary>
			<LayoutComponent>
				{!isMobile && <Header title="" showAuthControls={false} />}

				{activeView === "dashboard" && (
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
				)}

				{activeView === "analytics" && (
					<section>
						<AnalyticsDashboard tasks={allTasks} />
					</section>
				)}

				{activeView === "activity" && (
					<section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
						<RealTimeActivityFeed />
					</section>
				)}

				{activeView === "profiles" && (
					<section>
						<ProfileManagement />
					</section>
				)}

				{activeView === "profile-analytics" && (
					<section>
						<ProfileAnalytics />
					</section>
				)}
			</LayoutComponent>

			<PWAInstallPrompt />
		</EnhancedErrorBoundary>
	);
}

export function AnalyticsRoute() {
	return <DashboardPage initialView="analytics" />;
}

export function ActivityRoute() {
	return <DashboardPage initialView="activity" />;
}

export function ProfilesRoute() {
	return <DashboardPage initialView="profiles" />;
}

export function ProfileAnalyticsRoute() {
	return <DashboardPage initialView="profile-analytics" />;
}
