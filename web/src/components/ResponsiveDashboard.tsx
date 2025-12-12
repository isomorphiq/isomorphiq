import { useState } from "react";

interface ResponsiveDashboardProps {
    totalTasks: number;
    todoCount: number;
    inProgressCount: number;
    doneCount: number;
    nextUp?: { title?: string } | null;
    isOnline: boolean;
    syncInProgress: boolean;
}

export function ResponsiveDashboard({
    totalTasks,
    todoCount,
    inProgressCount,
    doneCount,
    nextUp,
    isOnline,
    syncInProgress,
}: ResponsiveDashboardProps) {
    const [showQuickActions, setShowQuickActions] = useState(false);

    const summaryCards = [
        { label: "Next Up", value: nextUp ? nextUp.title : "—", accent: "#38bdf8", icon: "🎯" },
        { label: "In Progress", value: inProgressCount, accent: "#f59e0b", icon: "⚡" },
        { label: "Todo", value: todoCount, accent: "#3b82f6", icon: "📋" },
        { label: "Done", value: doneCount, accent: "#22c55e", icon: "✅" },
        { label: "Total", value: totalTasks, accent: "#c084fc", icon: "📊" },
    ];

    return (
        <div style={{ marginBottom: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "12px",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "#0b1220",
                    border: "1px solid #1f2937",
                    borderRadius: "12px",
                    padding: "12px",
                    boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <div
                        style={{
                            width: "12px",
                            height: "12px",
                            borderRadius: "50%",
                            background: isOnline ? "#22c55e" : "#ef4444",
                            animation: isOnline ? "pulse 2s infinite" : "none",
                        }}
                    />
                    <span style={{ fontSize: "14px", fontWeight: 700, color: isOnline ? "#22c55e" : "#ef4444" }}>
                        {isOnline ? "Online" : "Offline"}
                    </span>
                    {syncInProgress && (
                        <span style={{ fontSize: "12px", color: "#f59e0b", fontWeight: 700 }}>syncing...</span>
                    )}
                    {nextUp?.title && (
                        <span style={{ fontSize: "12px", color: "#94a3b8" }}>Next: {nextUp.title}</span>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => setShowQuickActions((value) => !value)}
                    style={{
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid #1f2937",
                        background: "#111827",
                        color: "#e2e8f0",
                        fontWeight: 700,
                        cursor: "pointer",
                    }}
                >
                    {showQuickActions ? "Hide quick actions" : "Quick actions"}
                </button>
            </div>

            {showQuickActions && (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                        gap: "10px",
                        background: "#0b1220",
                        border: "1px solid #1f2937",
                        borderRadius: "12px",
                        padding: "10px",
                        boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
                    }}
                >
                    {[
                        { label: "New Task", icon: "📝" },
                        { label: "Refresh", icon: "🔄" },
                        { label: "Search", icon: "🔍" },
                        { label: "Analytics", icon: "📈" },
                    ].map((action) => (
                        <button
                            key={action.label}
                            type="button"
                            style={{
                                padding: "10px 12px",
                                borderRadius: "10px",
                                border: "1px solid #1f2937",
                                background: "#111827",
                                color: "#e2e8f0",
                                fontWeight: 700,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "8px",
                            }}
                        >
                            <span>{action.icon}</span>
                            {action.label}
                        </button>
                    ))}
                </div>
            )}

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                    gap: "12px",
                }}
            >
                {summaryCards.map((card) => (
                    <div
                        key={card.label}
                        style={{
                            padding: "14px",
                            borderRadius: "12px",
                            border: "1px solid #1f2937",
                            background: "#0b1220",
                            boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
                            minHeight: "78px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                        }}
                    >
                        <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                            {card.icon} {card.label}
                        </div>
                        <div
                            style={{
                                fontWeight: 800,
                                fontSize: "18px",
                                color: card.accent,
                                lineHeight: 1.2,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {card.value}
                        </div>
                    </div>
                ))}
            </div>

            <style>{`
                @keyframes pulse {
                    0% { opacity: 1; }
                    50% { opacity: 0.5; }
                    100% { opacity: 1; }
                }
            `}</style>
        </div>
    );
}
