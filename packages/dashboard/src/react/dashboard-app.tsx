import { useCallback, useEffect, useMemo, useState } from "react";

const DEFAULT_DASHBOARD_GATEWAY_PATH = "/api/dashboard";

const CONTAINERS = [
    { id: "overview-metrics", label: "Overview" },
    { id: "queue-metrics", label: "Queue" },
    { id: "health-grid", label: "Health" },
] as const;

const WIDGET_DEFINITIONS = [
    {
        id: "my-tasks",
        label: "My Tasks",
        description: "Active tasks assigned to the current workflow.",
        defaultContainerId: "overview-metrics",
    },
    {
        id: "recent-activity",
        label: "Recent Activity",
        description: "Latest task events across the system.",
        defaultContainerId: "overview-metrics",
    },
    {
        id: "priority-breakdown",
        label: "Priority Breakdown",
        description: "High/medium/low distribution of tasks.",
        defaultContainerId: "queue-metrics",
    },
    {
        id: "search",
        label: "Search",
        description: "Filter tasks instantly by title, description, or id.",
        defaultContainerId: "queue-metrics",
    },
    {
        id: "system-health",
        label: "System Health",
        description: "Daemon, memory, and connectivity health.",
        defaultContainerId: "health-grid",
    },
] as const;

type ContainerId = (typeof CONTAINERS)[number]["id"];
type WidgetId = (typeof WIDGET_DEFINITIONS)[number]["id"];
type WidgetLayout = Record<ContainerId, WidgetId[]>;

type DashboardTask = {
    id: string;
    title: string;
    description?: string;
    status: string;
    priority: string;
    assignedTo?: string;
    updatedAt?: string;
};

type DashboardActivityLog = {
    id: string;
    timestamp: string;
    level: string;
    message: string;
};

type DashboardMetrics = {
    tasks?: {
        total?: number;
        pending?: number;
        inProgress?: number;
        completed?: number;
        byPriority?: {
            high?: number;
            medium?: number;
            low?: number;
        };
    };
    daemon?: {
        uptime?: number;
        pid?: number;
        memory?: {
            heapUsed?: number;
            heapTotal?: number;
        };
    };
    health?: {
        status?: string;
        tcpConnected?: boolean;
        wsConnections?: number;
        memoryUsage?: number;
    };
};

type QueueStatus = {
    total?: number;
    highPriority?: number;
    failed?: number;
};

type WidgetState = {
    layout: WidgetLayout;
    hiddenWidgetIds: WidgetId[];
};

const DEFAULT_LAYOUT: WidgetLayout = {
    "overview-metrics": ["my-tasks", "recent-activity"],
    "queue-metrics": ["priority-breakdown", "search"],
    "health-grid": ["system-health"],
};

const ALL_WIDGET_IDS = new Set<WidgetId>(
    WIDGET_DEFINITIONS.map((widget) => widget.id),
);

const DEFAULT_CONTAINER_BY_WIDGET_ID = WIDGET_DEFINITIONS.reduce<Record<WidgetId, ContainerId>>(
    (acc, widget) => ({
        ...acc,
        [widget.id]: widget.defaultContainerId as ContainerId,
    }),
    {} as Record<WidgetId, ContainerId>,
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const dedupe = <T extends string>(values: T[]): T[] =>
    values.reduce<T[]>(
        (acc, value) => (acc.includes(value) ? acc : acc.concat([value])),
        [],
    );

const normalizeHiddenWidgetIds = (value: unknown): WidgetId[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    const normalized = value
        .filter((entry): entry is WidgetId => typeof entry === "string" && ALL_WIDGET_IDS.has(entry as WidgetId));
    return dedupe(normalized);
};

const normalizeLayout = (value: unknown): WidgetLayout => {
    const candidate = isRecord(value) ? value : {};

    const perContainer = CONTAINERS.reduce<WidgetLayout>(
        (acc, container) => ({
            ...acc,
            [container.id]: Array.isArray(candidate[container.id])
                ? dedupe(
                    (candidate[container.id] as unknown[])
                        .filter((entry): entry is WidgetId =>
                            typeof entry === "string" && ALL_WIDGET_IDS.has(entry as WidgetId),
                        ),
                )
                : [],
        }),
        {
            "overview-metrics": [],
            "queue-metrics": [],
            "health-grid": [],
        },
    );

    const used = new Set<WidgetId>();
    const deduped = CONTAINERS.reduce<WidgetLayout>(
        (acc, container) => ({
            ...acc,
            [container.id]: perContainer[container.id].filter((widgetId) => {
                if (used.has(widgetId)) {
                    return false;
                }
                used.add(widgetId);
                return true;
            }),
        }),
        {
            "overview-metrics": [],
            "queue-metrics": [],
            "health-grid": [],
        },
    );

    const missing = WIDGET_DEFINITIONS.map((widget) => widget.id).filter((widgetId) => !used.has(widgetId));
    return missing.reduce<WidgetLayout>(
        (acc, widgetId) => {
            const containerId = DEFAULT_CONTAINER_BY_WIDGET_ID[widgetId];
            return {
                ...acc,
                [containerId]: acc[containerId].concat([widgetId]),
            };
        },
        deduped,
    );
};

const areStringArraysEqual = (left: string[], right: string[]): boolean =>
    left.length === right.length && left.every((value, index) => value === right[index]);

const areLayoutsEqual = (left: WidgetLayout, right: WidgetLayout): boolean =>
    CONTAINERS.every((container) =>
        areStringArraysEqual(left[container.id], right[container.id]),
    );

const joinPath = (basePath: string, suffix: string): string =>
    `${basePath.replace(/\/+$/, "")}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;

const formatUptime = (seconds: number | undefined): string => {
    if (!Number.isFinite(seconds) || !seconds || seconds <= 0) {
        return "n/a";
    }
    const total = Math.floor(seconds);
    const days = Math.floor(total / (60 * 60 * 24));
    const hours = Math.floor((total % (60 * 60 * 24)) / (60 * 60));
    const minutes = Math.floor((total % (60 * 60)) / 60);
    return `${days}d ${hours}h ${minutes}m`;
};

const formatBytes = (bytes: number | undefined): string => {
    if (!Number.isFinite(bytes) || !bytes || bytes <= 0) {
        return "n/a";
    }
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
};

export type DashboardAppProps = {
    dashboardGatewayPath?: string;
    className?: string;
};

export function DashboardApp({
    dashboardGatewayPath = DEFAULT_DASHBOARD_GATEWAY_PATH,
    className,
}: DashboardAppProps) {
    const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
    const [tasks, setTasks] = useState<DashboardTask[]>([]);
    const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
    const [activityLogs, setActivityLogs] = useState<DashboardActivityLog[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [draggingWidgetId, setDraggingWidgetId] = useState<WidgetId | null>(null);
    const [widgetState, setWidgetState] = useState<WidgetState>({
        layout: DEFAULT_LAYOUT,
        hiddenWidgetIds: [],
    });

    const fetchJson = useCallback(
        async (path: string): Promise<unknown> => {
            const response = await window.fetch(joinPath(dashboardGatewayPath, path));
            if (!response.ok) {
                throw new Error(`Request failed (${response.status}) for ${path}`);
            }
            return await response.json();
        },
        [dashboardGatewayPath],
    );

    const persistLayout = useCallback(
        async (layout: WidgetLayout): Promise<void> => {
            await window.fetch(joinPath(dashboardGatewayPath, "/api/widgets/layout"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ widgetLayout: layout, fullLayout: true }),
            });
        },
        [dashboardGatewayPath],
    );

    const persistVisibility = useCallback(
        async (hiddenWidgetIds: WidgetId[]): Promise<void> => {
            await window.fetch(joinPath(dashboardGatewayPath, "/api/widgets/visibility"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hiddenWidgetIds }),
            });
        },
        [dashboardGatewayPath],
    );

    const refresh = useCallback(async (): Promise<void> => {
        const [metricsResult, tasksResult, queueResult, logsResult] = await Promise.allSettled([
            fetchJson("/api/metrics"),
            fetchJson("/api/tasks"),
            fetchJson("/api/queue/status"),
            fetchJson("/api/logs?limit=8"),
        ]);

        if (metricsResult.status === "fulfilled" && isRecord(metricsResult.value)) {
            setMetrics(metricsResult.value as DashboardMetrics);
        }
        if (tasksResult.status === "fulfilled" && Array.isArray(tasksResult.value)) {
            setTasks(tasksResult.value as DashboardTask[]);
        }
        if (queueResult.status === "fulfilled" && isRecord(queueResult.value)) {
            setQueueStatus(queueResult.value as QueueStatus);
        }
        if (logsResult.status === "fulfilled" && Array.isArray(logsResult.value)) {
            setActivityLogs(logsResult.value as DashboardActivityLog[]);
        }

        const hasAtLeastOneSuccess =
            metricsResult.status === "fulfilled"
            || tasksResult.status === "fulfilled"
            || queueResult.status === "fulfilled"
            || logsResult.status === "fulfilled";
        if (!hasAtLeastOneSuccess) {
            setError("Failed to load dashboard data from microservice.");
        } else {
            setError(null);
        }
    }, [fetchJson]);

    useEffect(() => {
        let cancelled = false;
        const load = async (): Promise<void> => {
            try {
                setLoading(true);
                await refresh();
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };
        void load();

        const intervalId = window.setInterval(() => {
            void refresh();
        }, 30000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [refresh]);

    useEffect(() => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/dashboard-ws`);
        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data as string) as { type?: string; data?: unknown };
                if (!message || typeof message.type !== "string") {
                    return;
                }

                if (message.type === "initial_state" && isRecord(message.data)) {
                    const data = message.data;
                    if (isRecord(data.metrics)) {
                        setMetrics(data.metrics as DashboardMetrics);
                    }
                    if (Array.isArray(data.tasks)) {
                        setTasks(data.tasks as DashboardTask[]);
                    }
                    setWidgetState((current) => {
                        const nextLayout = data.widgetLayout ? normalizeLayout(data.widgetLayout) : current.layout;
                        const nextHidden = data.hiddenWidgetIds
                            ? normalizeHiddenWidgetIds(data.hiddenWidgetIds)
                            : current.hiddenWidgetIds;
                        return {
                            layout: nextLayout,
                            hiddenWidgetIds: nextHidden,
                        };
                    });
                    return;
                }

                if (message.type === "metrics_update" && isRecord(message.data)) {
                    setMetrics(message.data as DashboardMetrics);
                    return;
                }

                if (message.type === "tasks_update" && Array.isArray(message.data)) {
                    setTasks(message.data as DashboardTask[]);
                    return;
                }

                if (message.type === "widget_layout_update" && isRecord(message.data)) {
                    const data = message.data;
                    if (Object.prototype.hasOwnProperty.call(data, "widgetLayout")) {
                        setWidgetState((current) => ({
                            ...current,
                            layout: normalizeLayout(data.widgetLayout),
                        }));
                    }
                    return;
                }

                if (message.type === "widget_visibility_update" && isRecord(message.data)) {
                    const data = message.data;
                    if (Object.prototype.hasOwnProperty.call(data, "hiddenWidgetIds")) {
                        setWidgetState((current) => ({
                            ...current,
                            hiddenWidgetIds: normalizeHiddenWidgetIds(data.hiddenWidgetIds),
                        }));
                    }
                }
            } catch {
                // Ignore malformed websocket payloads to keep dashboard interactive.
            }
        };

        return () => {
            ws.close();
        };
    }, []);

    const visibleWidgetIds = useMemo(
        () =>
            CONTAINERS.flatMap((container) => widgetState.layout[container.id]).filter(
                (widgetId) => !widgetState.hiddenWidgetIds.includes(widgetId),
            ),
        [widgetState],
    );

    const filteredTasks = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        if (!normalizedQuery) {
            return tasks;
        }
        return tasks.filter((task) =>
            `${task.title} ${task.description ?? ""} ${task.id}`.toLowerCase().includes(normalizedQuery),
        );
    }, [searchQuery, tasks]);

    const updateWidgetState = useCallback(
        (
            updater: (state: WidgetState) => WidgetState,
        ): void => {
            setWidgetState((current) => {
                const next = updater(current);
                const layoutChanged = !areLayoutsEqual(current.layout, next.layout);
                const hiddenChanged = !areStringArraysEqual(current.hiddenWidgetIds, next.hiddenWidgetIds);
                if (layoutChanged) {
                    void persistLayout(next.layout);
                }
                if (hiddenChanged) {
                    void persistVisibility(next.hiddenWidgetIds);
                }
                return next;
            });
        },
        [persistLayout, persistVisibility],
    );

    const moveWidget = useCallback(
        (widgetId: WidgetId, targetContainerId: ContainerId): void => {
            updateWidgetState((current) => {
                const removed = CONTAINERS.reduce<WidgetLayout>(
                    (acc, container) => ({
                        ...acc,
                        [container.id]: current.layout[container.id].filter((id) => id !== widgetId),
                    }),
                    {
                        "overview-metrics": [],
                        "queue-metrics": [],
                        "health-grid": [],
                    },
                );
                const nextLayout = {
                    ...removed,
                    [targetContainerId]: removed[targetContainerId].concat([widgetId]),
                };
                return {
                    ...current,
                    layout: normalizeLayout(nextLayout),
                };
            });
        },
        [updateWidgetState],
    );

    const hideWidget = useCallback(
        (widgetId: WidgetId): void => {
            updateWidgetState((current) => ({
                layout: CONTAINERS.reduce<WidgetLayout>(
                    (acc, container) => ({
                        ...acc,
                        [container.id]: current.layout[container.id].filter((id) => id !== widgetId),
                    }),
                    {
                        "overview-metrics": [],
                        "queue-metrics": [],
                        "health-grid": [],
                    },
                ),
                hiddenWidgetIds: dedupe(current.hiddenWidgetIds.concat([widgetId])),
            }));
        },
        [updateWidgetState],
    );

    const showWidget = useCallback(
        (widgetId: WidgetId): void => {
            updateWidgetState((current) => {
                const targetContainerId = DEFAULT_CONTAINER_BY_WIDGET_ID[widgetId];
                const withoutWidget = CONTAINERS.reduce<WidgetLayout>(
                    (acc, container) => ({
                        ...acc,
                        [container.id]: current.layout[container.id].filter((id) => id !== widgetId),
                    }),
                    {
                        "overview-metrics": [],
                        "queue-metrics": [],
                        "health-grid": [],
                    },
                );
                const nextLayout = {
                    ...withoutWidget,
                    [targetContainerId]: withoutWidget[targetContainerId].concat([widgetId]),
                };
                return {
                    layout: normalizeLayout(nextLayout),
                    hiddenWidgetIds: current.hiddenWidgetIds.filter((id) => id !== widgetId),
                };
            });
        },
        [updateWidgetState],
    );

    const renderWidgetContent = (widgetId: WidgetId) => {
        if (widgetId === "my-tasks") {
            const activeTasks = tasks
                .filter((task) => task.status === "todo" || task.status === "in-progress")
                .slice(0, 8);
            return (
                <div style={{ display: "grid", gap: "8px" }}>
                    {activeTasks.length === 0 && <div style={{ color: "var(--color-text-muted)" }}>No active tasks.</div>}
                    {activeTasks.map((task) => (
                        <div key={task.id} style={{ border: "1px solid var(--color-border-primary)", borderRadius: "8px", padding: "8px" }}>
                            <div style={{ fontWeight: 600 }}>{task.title}</div>
                            <div style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>
                                {task.status} · {task.priority}
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

        if (widgetId === "recent-activity") {
            return (
                <div style={{ display: "grid", gap: "8px" }}>
                    {activityLogs.length === 0 && <div style={{ color: "var(--color-text-muted)" }}>No recent activity.</div>}
                    {activityLogs.map((log) => (
                        <div key={log.id} style={{ border: "1px solid var(--color-border-primary)", borderRadius: "8px", padding: "8px" }}>
                            <div>{log.message}</div>
                            <div style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>{log.timestamp}</div>
                        </div>
                    ))}
                </div>
            );
        }

        if (widgetId === "priority-breakdown") {
            const high = metrics?.tasks?.byPriority?.high ?? 0;
            const medium = metrics?.tasks?.byPriority?.medium ?? 0;
            const low = metrics?.tasks?.byPriority?.low ?? 0;
            const total = Math.max(1, high + medium + low);
            const rows = [
                { label: "High", value: high, color: "#ef4444" },
                { label: "Medium", value: medium, color: "#f59e0b" },
                { label: "Low", value: low, color: "#22c55e" },
            ];
            return (
                <div style={{ display: "grid", gap: "8px" }}>
                    {rows.map((row) => (
                        <div key={row.label}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                                <span>{row.label}</span>
                                <span>{row.value}</span>
                            </div>
                            <div style={{ width: "100%", height: "8px", background: "var(--color-surface-secondary)", borderRadius: "999px" }}>
                                <div
                                    style={{
                                        width: `${String(Math.round((row.value / total) * 100))}%`,
                                        height: "100%",
                                        borderRadius: "999px",
                                        background: row.color,
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

        if (widgetId === "search") {
            return (
                <div style={{ display: "grid", gap: "10px" }}>
                    <input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search tasks..."
                        style={{
                            borderRadius: "8px",
                            border: "1px solid var(--color-border-primary)",
                            padding: "8px 10px",
                            background: "var(--color-surface-primary)",
                            color: "var(--color-text-primary)",
                        }}
                    />
                    <div style={{ maxHeight: "220px", overflow: "auto", display: "grid", gap: "8px" }}>
                        {filteredTasks.slice(0, 10).map((task) => (
                            <div key={task.id} style={{ border: "1px solid var(--color-border-primary)", borderRadius: "8px", padding: "8px" }}>
                                <div style={{ fontWeight: 600 }}>{task.title}</div>
                                <div style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>{task.id}</div>
                            </div>
                        ))}
                        {filteredTasks.length === 0 && <div style={{ color: "var(--color-text-muted)" }}>No tasks match this search.</div>}
                    </div>
                </div>
            );
        }

        const healthStatus = metrics?.health?.status ?? "unknown";
        return (
            <div style={{ display: "grid", gap: "8px" }}>
                <div>Status: <strong>{healthStatus}</strong></div>
                <div>Daemon PID: <strong>{String(metrics?.daemon?.pid ?? "n/a")}</strong></div>
                <div>Uptime: <strong>{formatUptime(metrics?.daemon?.uptime)}</strong></div>
                <div>Memory: <strong>{formatBytes(metrics?.daemon?.memory?.heapUsed)} / {formatBytes(metrics?.daemon?.memory?.heapTotal)}</strong></div>
                <div>TCP: <strong>{metrics?.health?.tcpConnected ? "connected" : "disconnected"}</strong></div>
                <div>WS Clients: <strong>{String(metrics?.health?.wsConnections ?? 0)}</strong></div>
                <div>Queue: <strong>{String(queueStatus?.total ?? 0)}</strong> total, <strong>{String(queueStatus?.failed ?? 0)}</strong> failed</div>
            </div>
        );
    };

    return (
        <div className={className}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
                <div style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
                    Tasks: {String(metrics?.tasks?.total ?? tasks.length)} · Pending: {String(metrics?.tasks?.pending ?? 0)} · In Progress: {String(metrics?.tasks?.inProgress ?? 0)} · Done: {String(metrics?.tasks?.completed ?? 0)}
                </div>
                <button
                    type="button"
                    onClick={() => {
                        void refresh();
                    }}
                    style={{
                        border: "1px solid var(--color-border-primary)",
                        borderRadius: "8px",
                        padding: "8px 12px",
                        background: "var(--color-surface-secondary)",
                        color: "var(--color-text-primary)",
                        cursor: "pointer",
                        fontWeight: 600,
                    }}
                >
                    Refresh
                </button>
            </div>

            {loading && <div style={{ color: "var(--color-text-muted)", marginBottom: "10px" }}>Loading dashboard...</div>}
            {error && (
                <div style={{ marginBottom: "10px", padding: "10px", borderRadius: "8px", border: "1px solid #ef4444", background: "#7f1d1d", color: "#fee2e2" }}>
                    {error}
                </div>
            )}

            <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginBottom: "16px" }}>
                {WIDGET_DEFINITIONS.map((widget) => {
                    const isVisible = visibleWidgetIds.includes(widget.id);
                    return (
                        <div key={widget.id} style={{ border: "1px solid var(--color-border-primary)", borderRadius: "10px", padding: "10px", background: "var(--color-surface-secondary)" }}>
                            <div style={{ fontWeight: 700, marginBottom: "4px" }}>{widget.label}</div>
                            <div style={{ color: "var(--color-text-muted)", fontSize: "12px", marginBottom: "8px" }}>{widget.description}</div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (isVisible) {
                                        hideWidget(widget.id);
                                    } else {
                                        showWidget(widget.id);
                                    }
                                }}
                                style={{
                                    border: "1px solid var(--color-border-primary)",
                                    borderRadius: "8px",
                                    padding: "6px 10px",
                                    background: "var(--color-surface-primary)",
                                    color: "var(--color-text-primary)",
                                    cursor: "pointer",
                                }}
                            >
                                {isVisible ? "Remove from dashboard" : "Add to dashboard"}
                            </button>
                        </div>
                    );
                })}
            </div>

            <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
                {CONTAINERS.map((container) => (
                    <section
                        key={container.id}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                            event.preventDefault();
                            if (!draggingWidgetId) {
                                return;
                            }
                            moveWidget(draggingWidgetId, container.id);
                            setDraggingWidgetId(null);
                        }}
                        style={{
                            border: "1px solid var(--color-border-primary)",
                            borderRadius: "10px",
                            background: "var(--color-surface-primary)",
                            padding: "10px",
                            minHeight: "180px",
                        }}
                    >
                        <div style={{ fontWeight: 700, marginBottom: "8px" }}>{container.label}</div>
                        <div style={{ display: "grid", gap: "10px" }}>
                            {widgetState.layout[container.id]
                                .filter((widgetId) => !widgetState.hiddenWidgetIds.includes(widgetId))
                                .map((widgetId) => {
                                    const widgetDefinition = WIDGET_DEFINITIONS.find((widget) => widget.id === widgetId);
                                    if (!widgetDefinition) {
                                        return null;
                                    }
                                    return (
                                        <article
                                            key={widgetId}
                                            draggable
                                            onDragStart={() => setDraggingWidgetId(widgetId)}
                                            onDragEnd={() => setDraggingWidgetId(null)}
                                            style={{
                                                border: "1px solid var(--color-border-primary)",
                                                borderRadius: "10px",
                                                background: "var(--color-surface-secondary)",
                                                padding: "10px",
                                                cursor: "grab",
                                            }}
                                        >
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                                <div style={{ fontWeight: 700 }}>{widgetDefinition.label}</div>
                                                <button
                                                    type="button"
                                                    onClick={() => hideWidget(widgetId)}
                                                    style={{
                                                        border: "1px solid var(--color-border-primary)",
                                                        borderRadius: "6px",
                                                        background: "transparent",
                                                        color: "var(--color-text-primary)",
                                                        padding: "3px 8px",
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    Hide
                                                </button>
                                            </div>
                                            {renderWidgetContent(widgetId)}
                                        </article>
                                    );
                                })}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}
