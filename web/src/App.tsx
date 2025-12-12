import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute.tsx";
import { TaskDetailPage } from "./components/TaskDetailPage.tsx";
import { ThemeProvider } from "./components/ThemeProvider.tsx";
import { EnhancedErrorBoundary } from "./components/UIComponents.tsx";
import { UserProfilePage } from "./components/UserProfilePage.tsx";
import { WorkflowPage } from "./components/WorkflowPage.tsx";
import { useRouteProgress } from "./hooks/useRouteProgress.ts";
import { ActivityPage } from "./pages/ActivityPage.tsx";
import { AnalyticsPage } from "./pages/AnalyticsPage.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { DependencyAnalysisRoute } from "./pages/DependencyAnalysisRoute.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ProfileAnalyticsPage } from "./pages/ProfileAnalyticsPage.tsx";
import { ProfilesPage } from "./pages/ProfilesPage.tsx";
import { RegisterPage } from "./pages/RegisterPage.tsx";
import { SecurityPage } from "./pages/SecurityPage.tsx";
import { ThemeDemoPage } from "./pages/ThemeDemoPage.tsx";

export function App() {
    const location = useLocation();
    const routeLoading = useRouteProgress(location);

    return (
        <ThemeProvider>
            {routeLoading && (
                <div
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: "3px",
                        background: "linear-gradient(90deg, var(--color-accent-primary), var(--color-accent-secondary))",
                        opacity: 0.9,
                        zIndex: 2000,
                        boxShadow: "0 0 12px var(--color-shadow-md)",
                    }}
                />
            )}

            <EnhancedErrorBoundary>
                <Routes>
                    <Route index element={<DashboardPage />} />
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
                    <Route path="/analytics" element={<AnalyticsPage />} />
                    <Route path="/activity" element={<ActivityPage />} />
                    <Route path="/profiles" element={<ProfilesPage />} />
                    <Route
                        path="/profile-analytics"
                        element={<ProfileAnalyticsPage />}
                    />
                    <Route path="/workflow" element={<WorkflowPage />} />
                    <Route
                        path="/dependencies"
                        element={<DependencyAnalysisRoute />}
                    />
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
                    <Route path="/theme-demo" element={<ThemeDemoPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </EnhancedErrorBoundary>
        </ThemeProvider>
    );
}

export default App;
