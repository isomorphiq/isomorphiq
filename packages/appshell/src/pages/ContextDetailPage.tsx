import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { authAtom } from "../authAtoms.ts";
import { Header, Layout } from "../components/Layout.tsx";
import { SectionCard } from "../components/SectionCard.tsx";
import { EnhancedErrorBoundary } from "../components/UIComponents.tsx";

type ContextData = Record<string, unknown>;

type ContextRecord = {
    id: string;
    data: ContextData;
    createdAt: string;
    updatedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const resolveContextKind = (record: ContextRecord): "file" | "worker" => {
    const fileContext = record.data.fileContext;
    return isRecord(fileContext) ? "file" : "worker";
};

const formatDate = (value: string): string => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }
    return parsed.toLocaleString();
};

export function ContextDetailPage() {
    const { contextId } = useParams<{ contextId: string }>();
    const auth = useAtomValue(authAtom);
    const [context, setContext] = useState<ContextRecord | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadContext = async () => {
            if (!auth.token || !contextId) {
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const response = await fetch(`/api/contexts/${encodeURIComponent(contextId)}`, {
                    headers: {
                        Authorization: `Bearer ${auth.token}`,
                    },
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error ?? "Failed to load context");
                }
                setContext((data.context ?? null) as ContextRecord | null);
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : "Failed to load context");
            } finally {
                setLoading(false);
            }
        };
        void loadContext();
    }, [auth.token, contextId]);

    const prettyData = useMemo(() => JSON.stringify(context?.data ?? {}, null, 2), [context]);
    const kind = context ? resolveContextKind(context) : null;

    return (
        <EnhancedErrorBoundary>
            <Layout>
                <Header title="Context Details" showAuthControls={false} />
                <nav style={{ marginBottom: "12px" }}>
                    <Link to="/context" style={{ color: "#93c5fd" }}>
                        ← Back to Context List
                    </Link>
                </nav>
                <SectionCard title={context?.id ?? contextId ?? "Context"}>
                    {loading && <div style={{ color: "var(--color-text-secondary)" }}>Loading context...</div>}
                    {error && (
                        <div
                            style={{
                                border: "1px solid #ef4444",
                                borderRadius: "8px",
                                padding: "10px 12px",
                                color: "#ef4444",
                                background: "rgba(239,68,68,0.1)",
                            }}
                        >
                            {error}
                        </div>
                    )}
                    {!loading && !error && context && (
                        <div style={{ display: "grid", gap: "12px" }}>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                <span style={{ color: "var(--color-text-secondary)" }}>Type:</span>
                                <span
                                    style={{
                                        fontSize: "12px",
                                        fontWeight: 700,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.04em",
                                        borderRadius: "999px",
                                        padding: "2px 8px",
                                        background:
                                            kind === "file"
                                                ? "rgba(34,197,94,0.18)"
                                                : "rgba(59,130,246,0.18)",
                                        color: kind === "file" ? "#22c55e" : "#60a5fa",
                                    }}
                                >
                                    {kind} context
                                </span>
                            </div>
                            <div style={{ color: "var(--color-text-secondary)" }}>
                                Created: {formatDate(context.createdAt)}
                            </div>
                            <div style={{ color: "var(--color-text-secondary)" }}>
                                Updated: {formatDate(context.updatedAt)}
                            </div>
                            <div>
                                <div style={{ color: "var(--color-text-secondary)", marginBottom: "6px" }}>
                                    Contents
                                </div>
                                <pre
                                    style={{
                                        margin: 0,
                                        padding: "12px",
                                        borderRadius: "10px",
                                        border: "1px solid var(--color-border-primary)",
                                        background: "var(--color-surface-secondary)",
                                        color: "var(--color-text-primary)",
                                        overflowX: "auto",
                                        whiteSpace: "pre-wrap",
                                    }}
                                >
                                    {prettyData}
                                </pre>
                            </div>
                        </div>
                    )}
                </SectionCard>
            </Layout>
        </EnhancedErrorBoundary>
    );
}
