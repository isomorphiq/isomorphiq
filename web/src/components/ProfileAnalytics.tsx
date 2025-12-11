import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "./SectionCard.tsx";

interface ProfileMetrics {
	throughput: number;
	successRate: number;
	averageTaskDuration: number;
	queueWaitTime: number;
	errorRate: number;
}

interface ProfileAnalytics {
	[profileName: string]: ProfileMetrics;
}

export function ProfileAnalytics() {
	const [analytics, setAnalytics] = useState<ProfileAnalytics>({});
	const [loading, setLoading] = useState(true);
	const [timeRange, setTimeRange] = useState<"1h" | "24h" | "7d">("1h");

	const fetchAnalytics = useCallback(async () => {
		try {
			const response = await fetch("/api/profiles/metrics");
			const data = await response.json();
			setAnalytics(data);
			setLoading(false);
		} catch (error) {
			console.error("Failed to fetch profile analytics:", error);
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchAnalytics();
		const interval = setInterval(fetchAnalytics, 10000); // Update every 10 seconds
		return () => clearInterval(interval);
	}, [fetchAnalytics]);

	const formatPercentage = (value: number): string => {
		return `${value.toFixed(1)}%`;
	};

	const formatDuration = (seconds: number): string => {
		if (seconds < 60) return `${seconds.toFixed(1)}s`;
		if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
		return `${(seconds / 3600).toFixed(1)}h`;
	};

	const getHealthColor = (successRate: number): string => {
		if (successRate >= 95) return "#10b981";
		if (successRate >= 85) return "#f59e0b";
		return "#ef4444";
	};

	const getEfficiencyColor = (throughput: number): string => {
		if (throughput >= 10) return "#10b981";
		if (throughput >= 5) return "#f59e0b";
		return "#ef4444";
	};

	if (loading) {
		return (
			<SectionCard title="Profile Analytics">
				<div style={{ textAlign: "center", padding: "40px" }}>Loading analytics...</div>
			</SectionCard>
		);
	}

	const profileNames = Object.keys(analytics);
	if (profileNames.length === 0) {
		return (
			<SectionCard title="Profile Analytics">
				<div
					style={{
						textAlign: "center",
						padding: "40px",
						color: "#94a3b8",
					}}
				>
					No profile data available
				</div>
			</SectionCard>
		);
	}

	// Calculate aggregate metrics
	const avgSuccessRate =
		profileNames.reduce((sum, name) => sum + analytics[name].successRate, 0) / profileNames.length;
	const totalThroughput = profileNames.reduce((sum, name) => sum + analytics[name].throughput, 0);
	const avgErrorRate =
		profileNames.reduce((sum, name) => sum + analytics[name].errorRate, 0) / profileNames.length;

	return (
		<div style={{ display: "grid", gap: "16px" }}>
			{/* Time Range Selector */}
			<SectionCard title="Analytics Dashboard">
				<div
					style={{
						display: "flex",
						gap: "8px",
						marginBottom: "16px",
					}}
				>
					{[
						{ id: "1h", label: "1 Hour" },
						{ id: "24h", label: "24 Hours" },
						{ id: "7d", label: "7 Days" },
					].map((range) => (
						<button
							key={range.id}
							type="button"
							onClick={() => setTimeRange(range.id)}
							style={{
								padding: "8px 16px",
								borderRadius: "6px",
								border: "none",
								background: timeRange === range.id ? "#3b82f6" : "#374151",
								color: timeRange === range.id ? "white" : "#9ca3af",
								fontSize: "14px",
								cursor: "pointer",
							}}
						>
							{range.label}
						</button>
					))}
				</div>

				{/* Overview Stats */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
						gap: "16px",
						marginBottom: "24px",
					}}
				>
					<div
						style={{
							background: "#1f2937",
							padding: "16px",
							borderRadius: "8px",
							textAlign: "center",
						}}
					>
						<div
							style={{
								fontSize: "24px",
								fontWeight: "bold",
								color: "#3b82f6",
							}}
						>
							{totalThroughput.toFixed(1)}
						</div>
						<div
							style={{
								fontSize: "12px",
								color: "#9ca3af",
								marginTop: "4px",
							}}
						>
							Total Tasks/Hour
						</div>
					</div>

					<div
						style={{
							background: "#1f2937",
							padding: "16px",
							borderRadius: "8px",
							textAlign: "center",
						}}
					>
						<div
							style={{
								fontSize: "24px",
								fontWeight: "bold",
								color: getHealthColor(avgSuccessRate),
							}}
						>
							{formatPercentage(avgSuccessRate)}
						</div>
						<div
							style={{
								fontSize: "12px",
								color: "#9ca3af",
								marginTop: "4px",
							}}
						>
							Average Success Rate
						</div>
					</div>

					<div
						style={{
							background: "#1f2937",
							padding: "16px",
							borderRadius: "8px",
							textAlign: "center",
						}}
					>
						<div
							style={{
								fontSize: "24px",
								fontWeight: "bold",
								color: getHealthColor(100 - avgErrorRate),
							}}
						>
							{formatPercentage(100 - avgErrorRate)}
						</div>
						<div
							style={{
								fontSize: "12px",
								color: "#9ca3af",
								marginTop: "4px",
							}}
						>
							System Health
						</div>
					</div>

					<div
						style={{
							background: "#1f2937",
							padding: "16px",
							borderRadius: "8px",
							textAlign: "center",
						}}
					>
						<div
							style={{
								fontSize: "24px",
								fontWeight: "bold",
								color: "#8b5cf6",
							}}
						>
							{profileNames.length}
						</div>
						<div
							style={{
								fontSize: "12px",
								color: "#9ca3af",
								marginTop: "4px",
							}}
						>
							Active Profiles
						</div>
					</div>
				</div>
			</SectionCard>

			{/* Individual Profile Analytics */}
			{profileNames.map((profileName) => {
				const metrics = analytics[profileName];
				return (
					<SectionCard key={profileName} title={`${profileName} Performance`}>
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
								gap: "16px",
							}}
						>
							<div>
								<div
									style={{
										fontSize: "12px",
										color: "#9ca3af",
										marginBottom: "4px",
									}}
								>
									Throughput
								</div>
								<div
									style={{
										fontSize: "18px",
										fontWeight: "bold",
										color: getEfficiencyColor(metrics.throughput),
									}}
								>
									{metrics.throughput.toFixed(1)}
								</div>
								<div
									style={{
										fontSize: "11px",
										color: "#6b7280",
									}}
								>
									tasks/hour
								</div>
							</div>

							<div>
								<div
									style={{
										fontSize: "12px",
										color: "#9ca3af",
										marginBottom: "4px",
									}}
								>
									Success Rate
								</div>
								<div
									style={{
										fontSize: "18px",
										fontWeight: "bold",
										color: getHealthColor(metrics.successRate),
									}}
								>
									{formatPercentage(metrics.successRate)}
								</div>
								<div
									style={{
										fontSize: "11px",
										color: "#6b7280",
									}}
								>
									last hour
								</div>
							</div>

							<div>
								<div
									style={{
										fontSize: "12px",
										color: "#9ca3af",
										marginBottom: "4px",
									}}
								>
									Error Rate
								</div>
								<div
									style={{
										fontSize: "18px",
										fontWeight: "bold",
										color: getHealthColor(100 - metrics.errorRate),
									}}
								>
									{formatPercentage(metrics.errorRate)}
								</div>
								<div
									style={{
										fontSize: "11px",
										color: "#6b7280",
									}}
								>
									last hour
								</div>
							</div>

							<div>
								<div
									style={{
										fontSize: "12px",
										color: "#9ca3af",
										marginBottom: "4px",
									}}
								>
									Avg Duration
								</div>
								<div
									style={{
										fontSize: "18px",
										fontWeight: "bold",
										color: "#10b981",
									}}
								>
									{formatDuration(metrics.averageTaskDuration)}
								</div>
								<div
									style={{
										fontSize: "11px",
										color: "#6b7280",
									}}
								>
									per task
								</div>
							</div>

							<div>
								<div
									style={{
										fontSize: "12px",
										color: "#9ca3af",
										marginBottom: "4px",
									}}
								>
									Queue Wait
								</div>
								<div
									style={{
										fontSize: "18px",
										fontWeight: "bold",
										color: "#f59e0b",
									}}
								>
									{formatDuration(metrics.queueWaitTime)}
								</div>
								<div
									style={{
										fontSize: "11px",
										color: "#6b7280",
									}}
								>
									estimated
								</div>
							</div>
						</div>

						{/* Performance Indicator */}
						<div
							style={{
								marginTop: "16px",
								padding: "12px",
								background: "#1f2937",
								borderRadius: "8px",
								display: "flex",
								alignItems: "center",
								gap: "8px",
							}}
						>
							<div
								style={{
									width: "12px",
									height: "12px",
									borderRadius: "50%",
									backgroundColor: getHealthColor(metrics.successRate),
								}}
							/>
							<span style={{ fontSize: "14px", color: "#e2e8f0" }}>
								{metrics.successRate >= 95
									? "Excellent Performance"
									: metrics.successRate >= 85
										? "Good Performance"
										: metrics.successRate >= 70
											? "Fair Performance"
											: "Poor Performance"}
							</span>
						</div>
					</SectionCard>
				);
			})}
		</div>
	);
}
