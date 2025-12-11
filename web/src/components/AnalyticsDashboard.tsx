import { useCallback, useEffect, useState } from "react";
import type { Task } from "../../../src/types.ts";

interface AnalyticsData {
	overview: {
		totalTasks: number;
		completedTasks: number;
		inProgressTasks: number;
		todoTasks: number;
		completionRate: number;
	};
	today: {
		created: number;
		completed: number;
	};
	priority: {
		high: number;
		medium: number;
		low: number;
	};
	timeline: Array<{
		date: string;
		created: number;
		completed: number;
	}>;
	recentActivity: Array<{
		id: string;
		title: string;
		status: string;
		priority: string;
		updatedAt: string;
		createdAt: string;
	}>;
	performance: {
		avgCompletionTime: string;
		productivityScore: string;
		totalActiveTasks: number;
	};
	generatedAt: string;
}

interface AnalyticsDashboardProps {
	_tasks: Task[];
}

export function AnalyticsDashboard({ _tasks }: AnalyticsDashboardProps) {
	const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");

	const fetchAnalytics = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);

			const response = await fetch("/api/analytics");
			if (!response.ok) {
				throw new Error("Failed to fetch analytics");
			}

			const data = await response.json();
			setAnalytics(data.analytics);
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchAnalytics();
	}, [fetchAnalytics]);

	if (loading) {
		return (
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
					padding: "40px",
					color: "#9ca3af",
				}}
			>
				Loading analytics...
			</div>
		);
	}

	if (error || !analytics) {
		return (
			<div
				style={{
					padding: "20px",
					borderRadius: "8px",
					background: "#ef444420",
					border: "1px solid #ef4444",
					color: "#fca5a5",
				}}
			>
				Error loading analytics: {error}
				<button
					type="button"
					onClick={fetchAnalytics}
					style={{
						marginLeft: "12px",
						padding: "4px 12px",
						borderRadius: "4px",
						border: "1px solid #ef4444",
						background: "#ef4444",
						color: "white",
						fontSize: "12px",
						cursor: "pointer",
					}}
				>
					Retry
				</button>
			</div>
		);
	}

	const getCompletionTrend = () => {
		const recent = analytics.timeline.slice(-7);
		const older = analytics.timeline.slice(-14, -7);

		const recentCompleted = recent.reduce((sum, day) => sum + day.completed, 0);
		const olderCompleted = older.reduce((sum, day) => sum + day.completed, 0);

		if (olderCompleted === 0) return 0;
		return Math.round(((recentCompleted - olderCompleted) / olderCompleted) * 100);
	};

	const completionTrend = getCompletionTrend();

	return (
		<div style={{ display: "grid", gap: "20px" }}>
			{/* Header with Time Range Selector */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "8px",
				}}
			>
				<h3 style={{ margin: 0, color: "#f9fafb", fontSize: "20px" }}>Analytics Dashboard</h3>
				<div style={{ display: "flex", gap: "8px" }}>
					{(["7d", "30d", "90d"] as const).map((range) => (
						<button
							type="button"
							key={range}
							onClick={() => setTimeRange(range)}
							style={{
								padding: "6px 12px",
								borderRadius: "6px",
								border: "1px solid #374151",
								background: timeRange === range ? "#3b82f6" : "#374151",
								color: "#f9fafb",
								fontSize: "12px",
								cursor: "pointer",
							}}
						>
							{range === "7d" ? "7 Days" : range === "30d" ? "30 Days" : "90 Days"}
						</button>
					))}
				</div>
			</div>

			{/* Overview Cards */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
					gap: "16px",
				}}
			>
				<MetricCard
					label="Total Tasks"
					value={analytics.overview.totalTasks}
					color="#6b7280"
					icon="📋"
				/>
				<MetricCard
					label="Completion Rate"
					value={`${analytics.overview.completionRate}%`}
					color="#10b981"
					icon="✅"
					trend={completionTrend}
				/>
				<MetricCard
					label="Active Tasks"
					value={analytics.performance.totalActiveTasks}
					color="#f59e0b"
					icon="⚡"
				/>
				<MetricCard
					label="Productivity Score"
					value={analytics.performance.productivityScore}
					color="#8b5cf6"
					icon="📈"
				/>
			</div>

			{/* Charts Row */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "2fr 1fr",
					gap: "16px",
				}}
			>
				{/* Timeline Chart */}
				<div
					style={{
						background: "#111827",
						border: "1px solid #1f2937",
						borderRadius: "12px",
						padding: "20px",
					}}
				>
					<h4 style={{ margin: "0 0 16px 0", color: "#f9fafb", fontSize: "16px" }}>
						Task Activity Timeline
					</h4>
					<TimelineChart data={analytics.timeline} />
				</div>

				{/* Priority Distribution */}
				<div
					style={{
						background: "#111827",
						border: "1px solid #1f2937",
						borderRadius: "12px",
						padding: "20px",
					}}
				>
					<h4 style={{ margin: "0 0 16px 0", color: "#f9fafb", fontSize: "16px" }}>
						Priority Distribution
					</h4>
					<PriorityChart data={analytics.priority} />
				</div>
			</div>

			{/* Recent Activity */}
			<div
				style={{
					background: "#111827",
					border: "1px solid #1f2937",
					borderRadius: "12px",
					padding: "20px",
				}}
			>
				<h4 style={{ margin: "0 0 16px 0", color: "#f9fafb", fontSize: "16px" }}>
					Recent Activity
				</h4>
				<ActivityFeed activities={analytics.recentActivity} />
			</div>

			{/* Performance Metrics */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
					gap: "16px",
				}}
			>
				<div
					style={{
						background: "#111827",
						border: "1px solid #1f2937",
						borderRadius: "12px",
						padding: "20px",
					}}
				>
					<h4 style={{ margin: "0 0 12px 0", color: "#f9fafb", fontSize: "14px" }}>
						Average Completion Time
					</h4>
					<div style={{ fontSize: "24px", fontWeight: "bold", color: "#3b82f6" }}>
						{analytics.performance.avgCompletionTime}
					</div>
				</div>

				<div
					style={{
						background: "#111827",
						border: "1px solid #1f2937",
						borderRadius: "12px",
						padding: "20px",
					}}
				>
					<h4 style={{ margin: "0 0 12px 0", color: "#f9fafb", fontSize: "14px" }}>
						Today's Activity
					</h4>
					<div style={{ display: "flex", gap: "16px" }}>
						<div>
							<div style={{ fontSize: "20px", fontWeight: "bold", color: "#10b981" }}>
								{analytics.today.completed}
							</div>
							<div style={{ fontSize: "12px", color: "#9ca3af" }}>Completed</div>
						</div>
						<div>
							<div style={{ fontSize: "20px", fontWeight: "bold", color: "#3b82f6" }}>
								{analytics.today.created}
							</div>
							<div style={{ fontSize: "12px", color: "#9ca3af" }}>Created</div>
						</div>
					</div>
				</div>
			</div>

			{/* Last Updated */}
			<div
				style={{
					textAlign: "center",
					fontSize: "12px",
					color: "#6b7280",
					marginTop: "8px",
				}}
			>
				Last updated: {new Date(analytics.generatedAt).toLocaleString()}
			</div>
		</div>
	);
}

interface MetricCardProps {
	label: string;
	value: string | number;
	color: string;
	icon: string;
	trend?: number;
}

function MetricCard({ label, value, color, icon, trend }: MetricCardProps) {
	return (
		<div
			style={{
				background: "#111827",
				border: "1px solid #1f2937",
				borderRadius: "12px",
				padding: "20px",
				position: "relative",
				overflow: "hidden",
			}}
		>
			<div
				style={{
					position: "absolute",
					top: "10px",
					right: "10px",
					fontSize: "24px",
					opacity: 0.3,
				}}
			>
				{icon}
			</div>

			<div style={{ marginBottom: "8px" }}>
				<div
					style={{
						fontSize: "24px",
						fontWeight: "bold",
						color: color,
						marginBottom: "4px",
					}}
				>
					{value}
				</div>
				<div
					style={{
						fontSize: "12px",
						color: "#9ca3af",
						textTransform: "uppercase",
						letterSpacing: "0.5px",
					}}
				>
					{label}
				</div>
			</div>

			{trend !== undefined && (
				<div
					style={{
						fontSize: "12px",
						color: trend >= 0 ? "#10b981" : "#ef4444",
						fontWeight: "500",
					}}
				>
					{trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}% from last period
				</div>
			)}
		</div>
	);
}

function TimelineChart({
	data,
}: {
	data: Array<{ date: string; created: number; completed: number }>;
}) {
	const maxValue = Math.max(...data.map((d) => Math.max(d.created, d.completed)));

	return (
		<div style={{ height: "200px", position: "relative" }}>
			{/* Simple bar chart visualization */}
			<div
				style={{
					display: "flex",
					alignItems: "flex-end",
					height: "160px",
					gap: "2px",
					padding: "0 4px",
				}}
			>
				{data.slice(-14).map((day, index) => (
					<div
						key={`day-${day.date}-${index}`}
						style={{
							flex: 1,
							display: "flex",
							flexDirection: "column",
							justifyContent: "flex-end",
							alignItems: "center",
							gap: "2px",
						}}
					>
						<div
							style={{
								width: "100%",
								height: `${(day.created / maxValue) * 60}px`,
								background: "#3b82f6",
								borderRadius: "2px",
								opacity: 0.8,
							}}
							title={`Created: ${day.created}`}
						/>
						<div
							style={{
								width: "100%",
								height: `${(day.completed / maxValue) * 60}px`,
								background: "#10b981",
								borderRadius: "2px",
								opacity: 0.8,
							}}
							title={`Completed: ${day.completed}`}
						/>
					</div>
				))}
			</div>

			{/* Legend */}
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					gap: "16px",
					marginTop: "12px",
					fontSize: "12px",
					color: "#9ca3af",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
					<div
						style={{ width: "12px", height: "12px", background: "#3b82f6", borderRadius: "2px" }}
					/>
					Created
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
					<div
						style={{ width: "12px", height: "12px", background: "#10b981", borderRadius: "2px" }}
					/>
					Completed
				</div>
			</div>
		</div>
	);
}

function PriorityChart({ data }: { data: { high: number; medium: number; low: number } }) {
	const total = data.high + data.medium + data.low;

	return (
		<div
			style={{
				height: "200px",
				display: "flex",
				flexDirection: "column",
				justifyContent: "center",
			}}
		>
			{/* Donut chart visualization */}
			<div
				style={{
					width: "120px",
					height: "120px",
					margin: "0 auto",
					position: "relative",
					borderRadius: "50%",
					background: `conic-gradient(
          #ef4444 0deg ${(data.high / total) * 360}deg,
          #f59e0b ${(data.high / total) * 360}deg ${((data.high + data.medium) / total) * 360}deg,
          #10b981 ${((data.high + data.medium) / total) * 360}deg 360deg
        )`,
				}}
			>
				<div
					style={{
						position: "absolute",
						top: "50%",
						left: "50%",
						transform: "translate(-50%, -50%)",
						width: "60px",
						height: "60px",
						background: "#111827",
						borderRadius: "50%",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: "18px",
						fontWeight: "bold",
						color: "#f9fafb",
					}}
				>
					{total}
				</div>
			</div>

			{/* Legend */}
			<div style={{ marginTop: "16px", fontSize: "12px" }}>
				<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
					<span style={{ color: "#ef4444" }}>High</span>
					<span style={{ color: "#9ca3af" }}>{data.high}</span>
				</div>
				<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
					<span style={{ color: "#f59e0b" }}>Medium</span>
					<span style={{ color: "#9ca3af" }}>{data.medium}</span>
				</div>
				<div style={{ display: "flex", justifyContent: "space-between" }}>
					<span style={{ color: "#10b981" }}>Low</span>
					<span style={{ color: "#9ca3af" }}>{data.low}</span>
				</div>
			</div>
		</div>
	);
}

function ActivityFeed({
	activities,
}: {
	activities: Array<{
		id: string;
		title: string;
		status: string;
		priority: string;
		updatedAt: string;
		createdAt: string;
	}>;
}) {
	return (
		<div style={{ maxHeight: "300px", overflowY: "auto" }}>
			{activities.length === 0 ? (
				<div style={{ textAlign: "center", color: "#9ca3af", padding: "20px" }}>
					No recent activity
				</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
					{activities.map((activity) => (
						<div
							key={activity.id}
							style={{
								padding: "12px",
								borderRadius: "8px",
								background: "#1f2937",
								border: "1px solid #374151",
								fontSize: "14px",
							}}
						>
							<div
								style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
							>
								<div style={{ flex: 1 }}>
									<div style={{ color: "#f9fafb", marginBottom: "4px" }}>{activity.title}</div>
									<div style={{ display: "flex", gap: "8px", fontSize: "12px" }}>
										<span
											style={{
												padding: "2px 6px",
												borderRadius: "4px",
												background:
													activity.status === "done"
														? "#10b98120"
														: activity.status === "in-progress"
															? "#f59e0b20"
															: "#3b82f620",
												color:
													activity.status === "done"
														? "#10b981"
														: activity.status === "in-progress"
															? "#f59e0b"
															: "#3b82f6",
											}}
										>
											{activity.status.replace("-", " ")}
										</span>
										<span style={{ color: "#9ca3af" }}>{activity.priority}</span>
									</div>
								</div>
								<div
									style={{
										fontSize: "12px",
										color: "#6b7280",
										textAlign: "right",
									}}
								>
									{new Date(activity.updatedAt).toLocaleDateString()}
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
