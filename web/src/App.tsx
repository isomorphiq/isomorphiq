import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute.tsx";
import { TaskDetailPage } from "./components/TaskDetailPage.tsx";
import { EnhancedErrorBoundary } from "./components/UIComponents.tsx";
import { UserProfilePage } from "./components/UserProfilePage.tsx";
import { WorkflowPage } from "./components/WorkflowPage.tsx";
import { useRouteProgress } from "./hooks/useRouteProgress.ts";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { DependencyAnalysisRoute } from "./pages/DependencyAnalysisRoute.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { RegisterPage } from "./pages/RegisterPage.tsx";
import { SecurityPage } from "./pages/SecurityPage.tsx";

export function App() {
	const location = useLocation();
	const routeLoading = useRouteProgress(location);

	return (
		<>
			{routeLoading && (
				<div
					style={{
						position: "fixed",
						top: 0,
						left: 0,
						right: 0,
						height: "3px",
						background: "linear-gradient(90deg, #3b82f6, #06b6d4)",
						opacity: 0.9,
						zIndex: 2000,
						boxShadow: "0 0 12px rgba(59, 130, 246, 0.6)",
					}}
				/>
			)}

			<EnhancedErrorBoundary>
				<Routes location={location} key={location.pathname}>
					<Route
						path="/login"
						element={
							<ProtectedRoute requireAuth={false}>
								<LoginPage />
							</ProtectedRoute>
						}
					/>
					<Route
						path="/register"
						element={
							<ProtectedRoute requireAuth={false}>
								<RegisterPage />
							</ProtectedRoute>
						}
					/>
					<Route
						path="/"
						element={<DashboardPage key="home" initialView="dashboard" />}
					/>
					<Route
						path="/analytics"
						element={<DashboardPage key="analytics" initialView="analytics" />}
					/>
					<Route
						path="/activity"
						element={<DashboardPage key="activity" initialView="activity" />}
					/>
					<Route
						path="/profiles"
						element={<DashboardPage key="profiles" initialView="profiles" />}
					/>
					<Route
						path="/profile-analytics"
						element={
							<DashboardPage key="profile-analytics" initialView="profile-analytics" />
						}
					/>
					<Route path="/workflow" element={<WorkflowPage />} />
					<Route path="/dependencies" element={<DependencyAnalysisRoute />} />
					<Route path="/tasks/:taskId" element={<TaskDetailPage />} />
					<Route
						path="/security"
						element={
							<ProtectedRoute>
								<SecurityPage />
							</ProtectedRoute>
						}
					/>
					<Route
						path="/users/me"
						element={
							<ProtectedRoute>
								<UserProfilePage />
							</ProtectedRoute>
						}
					/>
					<Route path="*" element={<Navigate to="/" replace />} />
				</Routes>
			</EnhancedErrorBoundary>
		</>
	);
}

export default App;
