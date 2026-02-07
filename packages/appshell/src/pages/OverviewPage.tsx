// FILE_CONTEXT: "context-91ccee85-acd7-4952-99d0-c7bf862219c2"

import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header, Layout } from "../components/Layout.tsx";
import { PWAInstallPrompt } from "../components/PWAInstallPrompt.tsx";
import { EnhancedErrorBoundary } from "../components/UIComponents.tsx";
import { useDashboardTasks } from "../hooks/useDashboardTasks.ts";
import { useIsMobile } from "../hooks/useIsMobile.ts";
import { DashboardView } from "./dashboard/DashboardView.tsx";

const visuallyHiddenStyle = {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
};

export function OverviewPage() {
    const {
        auth,
        mergedFilteredTasks,
        mergedQueue,
        totals,
        totalTaskCount,
        isInitialLoading,
        isOnline,
        syncInProgress,
        handleStatusChange,
        handlePriorityChange,
        handleDelete,
        refresh,
    } = useDashboardTasks();
    const [showCreateForm, setShowCreateForm] = useState(false);
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const header = <Header title="Overview" showAuthControls={false} />;

    const handleQuickNewTask = useCallback(() => {
        if (!auth.isAuthenticated) {
            throw new Error("Sign in to create tasks.");
        }
        setShowCreateForm(true);
        if (typeof document !== "undefined") {
            const section = document.getElementById("dashboard-create-task");
            if (section) {
                section.scrollIntoView({ behavior: "smooth", block: "start" });
            }
            const titleInput = document.getElementById("task-title");
            if (titleInput instanceof HTMLInputElement) {
                titleInput.focus();
                titleInput.select();
            }
        }
    }, [auth.isAuthenticated, setShowCreateForm]);

    const handleQuickRefresh = useCallback(() => {
        refresh();
    }, [refresh]);

    const handleQuickSearch = useCallback(() => {
        if (typeof document === "undefined") {
            return;
        }
        const input = document.getElementById("dashboard-search-input");
        if (!(input instanceof HTMLInputElement)) {
            throw new Error("Search is unavailable right now.");
        }
        input.focus();
        input.select();
        input.scrollIntoView({ behavior: "smooth", block: "center" });
    }, []);

    const handleQuickAnalytics = useCallback(() => {
        navigate("/analytics");
    }, [navigate]);

    return (
        <EnhancedErrorBoundary>
            <Layout>
                {isMobile ? <div style={visuallyHiddenStyle}>{header}</div> : header}

                <DashboardView
                    auth={auth}
                    isMobile={isMobile}
                    showCreateForm={showCreateForm}
                    onToggleCreate={() => setShowCreateForm((value) => !value)}
                    onCreateSuccess={refresh}
                    onQuickNewTask={handleQuickNewTask}
                    onQuickRefresh={handleQuickRefresh}
                    onQuickSearch={handleQuickSearch}
                    onQuickAnalytics={handleQuickAnalytics}
                    totals={totals}
                    totalTaskCount={totalTaskCount}
                    queue={mergedQueue}
                    tasks={mergedFilteredTasks}
                    onStatusChange={handleStatusChange}
                    onPriorityChange={handlePriorityChange}
                    onDelete={handleDelete}
                    isLoading={isInitialLoading}
                    isOnline={isOnline}
                    syncInProgress={syncInProgress}
                />
            </Layout>

            <PWAInstallPrompt />
        </EnhancedErrorBoundary>
    );
}
