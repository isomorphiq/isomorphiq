import { DashboardApp } from "@isomorphiq/dashboard/react";
import { Link } from "react-router-dom";
import { Header, Layout } from "../components/Layout.tsx";

export function DashboardMicroservicePage() {
    return (
        <Layout>
            <Header
                title="Dashboard"
                subtitle="Microservice dashboard with widget library and drag-and-drop."
                showAuthControls={false}
            />
            <div
                style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: "12px",
                    marginBottom: "10px",
                    flexWrap: "wrap",
                }}
            >
                <Link
                    to="/overview"
                    style={{
                        textDecoration: "none",
                        color: "var(--color-text-primary)",
                        border: "1px solid var(--color-border-primary)",
                        borderRadius: "8px",
                        padding: "8px 12px",
                        fontWeight: 600,
                        background: "var(--color-surface-secondary)",
                    }}
                >
                    Open overview
                </Link>
            </div>
            <DashboardApp />
        </Layout>
    );
}
