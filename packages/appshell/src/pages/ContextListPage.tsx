import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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

type ContextKind = "file" | "worker";

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const resolveContextKind = (record: ContextRecord): ContextKind => {
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

export function ContextListPage() {
    const auth = useAtomValue(authAtom);
    const [contexts, setContexts] = useState<ContextRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadContexts = async () => {
            if (!auth.token) {
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const response = await fetch("/api/contexts", {
                    headers: {
                        Authorization: `Bearer ${auth.token}`,
                    },
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error ?? "Failed to load contexts");
                }
                const list = Array.isArray(data.contexts) ? data.contexts : [];
                setContexts(list as ContextRecord[]);
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : "Failed to load contexts");
            } finally {
                setLoading(false);
            }
        };
        void loadContexts();
    }, [auth.token]);

    const sortedContexts = useMemo(
        () =>
            [...contexts].sort(
                (left, right) =>
                    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
            ),
        [contexts],
    );

    return (
        <EnhancedErrorBoundary>
            <Layout>
                <Header title="Context" subtitle="Browse context records" showAuthControls={false} />
                <SectionCard title={`Context Objects (${sortedContexts.length})`}>
                    {loading && <div style={{ color: "var(--color-text-secondary)" }}>Loading contexts...</div>}
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
                    {!loading && !error && sortedContexts.length === 0 && (
                        <div style={{ color: "var(--color-text-secondary)" }}>No context records found.</div>
                    )}
                    {!loading && !error && sortedContexts.length > 0 && (
                        <div style={{ display: "grid", gap: "8px" }}>
                            {sortedContexts.map((record) => {
                                const kind = resolveContextKind(record);
                                return (
                                    <Link
                                        key={record.id}
                                        to={`/context/${encodeURIComponent(record.id)}`}
                                        style={{
                                            textDecoration: "none",
                                            border: "1px solid var(--color-border-primary)",
                                            borderRadius: "10px",
                                            padding: "10px 12px",
                                            background: "var(--color-surface-secondary)",
                                            color: "var(--color-text-primary)",
                                            display: "grid",
                                            gap: "4px",
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                gap: "12px",
                                                flexWrap: "wrap",
                                            }}
                                        >
                                            <code style={{ fontWeight: 700 }}>{record.id}</code>
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
                                        <div style={{ color: "var(--color-text-secondary)", fontSize: "12px" }}>
                                            Updated: {formatDate(record.updatedAt)}
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </SectionCard>
            </Layout>
        </EnhancedErrorBoundary>
    );
}
