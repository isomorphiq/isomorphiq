import { useAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import type {
	TaskCreatedEvent,
	TaskDeletedEvent,
	TaskPriorityChangedEvent,
	TaskStatusChangedEvent,
	TaskUpdatedEvent,
	WebSocketEvent,
} from "@isomorphiq/realtime/types";
import { lastEventAtom } from "../atoms.ts";

interface ActivityItem {
	id: string;
	type: string;
	message: string;
	timestamp: Date;
	details?: Record<string, unknown>;
}

interface RealTimeActivityFeedProps {
	maxItems?: number;
}

interface ApiActivityLog {
    id?: string;
    timestamp: string;
    level?: string;
    message: string;
    data?: Record<string, unknown>;
}

export function RealTimeActivityFeed({ maxItems = 20 }: RealTimeActivityFeedProps) {
	const [activities, setActivities] = useState<ActivityItem[]>([]);
	const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [lastEvent] = useAtom(lastEventAtom);
	type ActivityEvent =
		| TaskCreatedEvent
		| TaskUpdatedEvent
		| TaskDeletedEvent
		| TaskStatusChangedEvent
		| TaskPriorityChangedEvent;
	const isActivityEvent = (event: WebSocketEvent): event is ActivityEvent =>
		[
			"task_created",
			"task_updated",
			"task_deleted",
			"task_status_changed",
			"task_priority_changed",
		].includes(event.type);
	const isRecord = (value: unknown): value is Record<string, unknown> =>
		Boolean(value) && typeof value === "object" && !Array.isArray(value);
	const toRecord = (value: unknown): Record<string, unknown> | undefined => {
		if (!isRecord(value)) return undefined;
		return value;
	};

	const mapEventToActivity = useCallback((event: ActivityEvent): ActivityItem => {
		const baseActivity = {
			id: `${event.type}-${event.timestamp.getTime()}`,
			type: event.type,
			timestamp: event.timestamp,
			details: toRecord(event.data),
		};

		switch (event.type) {
			case "task_created":
				return {
					...baseActivity,
					message: `New task created: "${event.data.task.title}"`,
				};
			case "task_updated":
				return {
					...baseActivity,
					message: `Task updated: "${event.data.task.title}"`,
				};
			case "task_deleted":
				return {
					...baseActivity,
					message: `Task deleted: ${event.data.taskId}`,
				};
			case "task_status_changed":
				return {
					...baseActivity,
					message: `Task "${event.data.task.title}" status changed from ${event.data.oldStatus} to ${event.data.newStatus}`,
				};
			case "task_priority_changed":
				return {
					...baseActivity,
					message: `Task "${event.data.task.title}" priority changed from ${event.data.oldPriority} to ${event.data.newPriority}`,
				};
		}
	}, []);

	const addActivityFromEvent = useCallback(
		(event: WebSocketEvent) => {
			if (!isActivityEvent(event)) return;
			const activity = mapEventToActivity(event);
			setActivities((prev) => [activity, ...prev].slice(0, maxItems));
		},
		[isActivityEvent, mapEventToActivity, maxItems],
	);

    const toDate = (value: string): Date => {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    };

    const fetchActivityLogs = useCallback(async () => {
        try {
            const response = await fetch(`/api/logs?limit=${maxItems}`, {
                headers: {
                    "Accept": "application/json",
                },
            });

            if (!response.ok) {
                throw new Error("Failed to load activity logs");
            }

            const logs = (await response.json()) as unknown;
            if (!Array.isArray(logs)) {
                throw new Error("Unexpected activity response shape");
            }

            const mappedLogs = logs
                .filter((entry): entry is ApiActivityLog => {
                    return Boolean(entry) && typeof entry === "object" && "message" in entry && "timestamp" in entry;
                })
                .slice(0, maxItems)
                .map((entry, index) => ({
                    id: typeof entry.id === "string" && entry.id.length > 0
                        ? entry.id
                        : `activity-${index}-${entry.timestamp}`,
                    type: typeof entry.level === "string" ? entry.level : "info",
                    message: entry.message,
                    timestamp: toDate(entry.timestamp),
                    details: toRecord(entry.data),
                }));

            setActivities(mappedLogs);
            setIsConnected(true);
            setErrorMessage(null);
        } catch (error) {
            console.error("Failed to fetch activity logs:", error);
            setIsConnected(false);
            setErrorMessage("Failed to load activity.");
        } finally {
            setIsLoading(false);
        }
    }, [maxItems]);

    useEffect(() => {
        void fetchActivityLogs();
        const intervalId = window.setInterval(() => {
            void fetchActivityLogs();
        }, 15000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [fetchActivityLogs]);

	useEffect(() => {
		if (lastEvent) {
            setIsConnected(true);
			addActivityFromEvent(lastEvent);
		}
	}, [lastEvent, addActivityFromEvent]);

	const formatTime = (date: Date) => {
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return "Just now";
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		return `${days}d ago`;
	};

	const getActivityIcon = (type: string) => {
		switch (type) {
			case "task_created":
				return "➕";
			case "task_updated":
				return "✏️";
			case "task_deleted":
				return "🗑️";
			case "task_status_changed":
				return "🔄";
			case "task_priority_changed":
				return "⚡";
			default:
				return "📝";
		}
	};

	const getActivityColor = (type: string) => {
		switch (type) {
			case "task_created":
				return "#10b981";
			case "task_updated":
				return "#3b82f6";
			case "task_deleted":
				return "#ef4444";
			case "task_status_changed":
				return "#f59e0b";
			case "task_priority_changed":
				return "#8b5cf6";
			default:
				return "#6b7280";
		}
	};

	return (
		<div
			style={{
				background: "#111827",
				border: "1px solid #1f2937",
				borderRadius: "12px",
				padding: "16px",
				height: "400px",
				display: "flex",
				flexDirection: "column",
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "16px",
				}}
			>
				<h3 style={{ margin: 0, color: "#f9fafb", fontSize: "16px" }}>Real-time Activity</h3>
				<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					<div
						style={{
							width: "8px",
							height: "8px",
							borderRadius: "50%",
							background: isConnected ? "#10b981" : "#ef4444",
							animation: isConnected ? "pulse 2s infinite" : "none",
						}}
					/>
					<span style={{ fontSize: "12px", color: "#9ca3af" }}>
						{isConnected ? "Connected" : "Disconnected"}
					</span>
				</div>
			</div>

			<div
				style={{
					flex: 1,
					overflowY: "auto",
					display: "flex",
					flexDirection: "column",
					gap: "8px",
				}}
			>
                {isLoading ? (
                    <div
                        style={{
                            textAlign: "center",
                            color: "#9ca3af",
                            padding: "40px",
                            fontStyle: "italic",
                        }}
                    >
                        Loading activity...
                    </div>
                ) : errorMessage ? (
                    <div
                        style={{
                            textAlign: "center",
                            color: "#fca5a5",
                            padding: "40px",
                            fontStyle: "italic",
                        }}
                    >
                        {errorMessage}
                    </div>
                ) : activities.length === 0 ? (
					<div
						style={{
							textAlign: "center",
							color: "#9ca3af",
							padding: "40px",
							fontStyle: "italic",
						}}
					>
						No recent activity
					</div>
				) : (
					activities.map((activity) => (
						<ActivityItem
							key={activity.id}
							activity={activity}
							icon={getActivityIcon(activity.type)}
							color={getActivityColor(activity.type)}
							formatTime={formatTime}
						/>
					))
				)}
			</div>

			<div
				style={{
					marginTop: "12px",
					paddingTop: "12px",
					borderTop: "1px solid #1f2937",
					fontSize: "12px",
					color: "#6b7280",
					textAlign: "center",
				}}
			>
				{activities.length} recent activities
			</div>
		</div>
	);
}

interface ActivityItemProps {
	activity: ActivityItem;
	icon: string;
	color: string;
	formatTime: (date: Date) => string;
}

function ActivityItem({ activity, icon, color, formatTime }: ActivityItemProps) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div
			style={{
				padding: "12px",
				borderRadius: "8px",
				background: "#1f2937",
				border: "1px solid #374151",
				fontSize: "14px",
				transition: "all 0.2s ease",
			}}
		>
			<div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
				<div
					style={{
						fontSize: "16px",
						color: color,
						flexShrink: 0,
						marginTop: "2px",
					}}
				>
					{icon}
				</div>

				<div style={{ flex: 1, minWidth: 0 }}>
					<div
						style={{
							color: "#f9fafb",
							marginBottom: "4px",
							wordBreak: "break-word",
						}}
					>
						{activity.message}
					</div>

					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
						}}
					>
						<span
							style={{
								fontSize: "12px",
								color: "#9ca3af",
								textTransform: "capitalize",
							}}
						>
							{activity.type.replace("_", " ")}
						</span>
						<span style={{ fontSize: "12px", color: "#6b7280" }}>
							{formatTime(activity.timestamp)}
						</span>
					</div>

					{activity.details && (
						<button
							type="button"
							onClick={() => setExpanded(!expanded)}
							style={{
								marginTop: "8px",
								padding: "2px 8px",
								borderRadius: "4px",
								border: "1px solid #374151",
								background: "#374151",
								color: "#9ca3af",
								fontSize: "11px",
								cursor: "pointer",
							}}
						>
							{expanded ? "Hide" : "Show"} Details
						</button>
					)}

					{expanded && activity.details && (
						<div
							style={{
								marginTop: "8px",
								padding: "8px",
								borderRadius: "4px",
								background: "#111827",
								border: "1px solid #374151",
								fontSize: "12px",
								color: "#cbd5e1",
							}}
						>
							<pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
								{JSON.stringify(activity.details, null, 2)}
							</pre>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

const style = document.createElement("style");
style.textContent = `
  @keyframes pulse {
    0% { opacity: 1; }
    50% { opacity: 0.5; }
    100% { opacity: 1; }
  }
`;
if (!document.head.querySelector("style[data-activity-feed]")) {
	style.setAttribute("data-activity-feed", "true");
	document.head.appendChild(style);
}
