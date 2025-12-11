import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "./SectionCard.tsx";

interface ProfileState {
	name: string;
	isActive: boolean;
	currentTasks: number;
	completedTasks: number;
	failedTasks: number;
	averageProcessingTime: number;
	lastActivity: string;
	queueSize: number;
	isProcessing: boolean;
}

interface ProfileMetrics {
	throughput: number;
	successRate: number;
	averageTaskDuration: number;
	queueWaitTime: number;
	errorRate: number;
}

interface ProfileData {
	profile: {
		name: string;
		role: string;
		capabilities: string[];
		maxConcurrentTasks: number;
		priority: number;
		color: string;
		icon: string;
	};
	state: ProfileState;
	metrics: ProfileMetrics;
}

export function ProfileManagement() {
	const [profiles, setProfiles] = useState<ProfileData[]>([]);
	const [loading, setLoading] = useState(true);
	const [_selectedProfile, _setSelectedProfile] = useState<string | null>(null);

	const fetchProfiles = useCallback(async () => {
		try {
			const response = await fetch("/api/profiles/with-states");
			const data = await response.json();
			setProfiles(data);
			setLoading(false);
		} catch (error) {
			console.error("Failed to fetch profiles:", error);
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchProfiles();
		const interval = setInterval(fetchProfiles, 5000); // Update every 5 seconds
		return () => clearInterval(interval);
	}, [fetchProfiles]);

	const toggleProfileStatus = async (profileName: string, isActive: boolean) => {
		try {
			const response = await fetch("/api/profiles/status", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: profileName, isActive }),
			});

			if (response.ok) {
				fetchProfiles(); // Refresh data
			}
		} catch (error) {
			console.error("Failed to update profile status:", error);
		}
	};

	const formatDuration = (seconds: number): string => {
		if (seconds < 60) return `${seconds.toFixed(1)}s`;
		if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
		return `${(seconds / 3600).toFixed(1)}h`;
	};

	const formatLastActivity = (lastActivity: string): string => {
		const date = new Date(lastActivity);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);

		if (diffMins < 1) return "Just now";
		if (diffMins < 60) return `${diffMins}m ago`;
		const diffHours = Math.floor(diffMins / 60);
		if (diffHours < 24) return `${diffHours}h ago`;
		return `${Math.floor(diffHours / 24)}d ago`;
	};

	if (loading) {
		return (
			<SectionCard title="Profile Management">
				<div style={{ textAlign: "center", padding: "40px" }}>Loading profiles...</div>
			</SectionCard>
		);
	}

	return (
		<div style={{ display: "grid", gap: "16px" }}>
			<SectionCard title="Multi-Profile System" countLabel={`${profiles.length} profiles`}>
				<div style={{ marginBottom: "16px", fontSize: "14px", color: "#94a3b8" }}>
					Intelligent task routing and processing across specialized AI profiles
				</div>
			</SectionCard>

			{profiles.map((profileData) => (
				<SectionCard
					key={profileData.profile.name}
					title={`${profileData.profile.icon} ${profileData.profile.role}`}
					countLabel={`${profileData.state.isActive ? "Active" : "Inactive"}`}
				>
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
						{/* Profile Info */}
						<div>
							<h4 style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#e2e8f0" }}>
								Profile Information
							</h4>
							<div style={{ fontSize: "12px", color: "#94a3b8", lineHeight: "1.4" }}>
								<div>
									<strong>Capabilities:</strong> {profileData.profile.capabilities.join(", ")}
								</div>
								<div>
									<strong>Max Concurrent:</strong> {profileData.profile.maxConcurrentTasks}
								</div>
								<div>
									<strong>Priority:</strong> {profileData.profile.priority}
								</div>
								<div>
									<strong>Last Activity:</strong>{" "}
									{formatLastActivity(profileData.state.lastActivity)}
								</div>
							</div>
						</div>

						{/* Current Status */}
						<div>
							<h4 style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#e2e8f0" }}>
								Current Status
							</h4>
							<div style={{ fontSize: "12px", color: "#94a3b8", lineHeight: "1.4" }}>
								<div>
									<strong>Status:</strong>
									<span
										style={{
											color: profileData.state.isProcessing ? "#10b981" : "#6b7280",
											marginLeft: "4px",
										}}
									>
										{profileData.state.isProcessing ? "Processing" : "Idle"}
									</span>
								</div>
								<div>
									<strong>Current Tasks:</strong> {profileData.state.currentTasks}
								</div>
								<div>
									<strong>Queue Size:</strong> {profileData.state.queueSize}
								</div>
								<div>
									<strong>Avg Duration:</strong>{" "}
									{formatDuration(profileData.state.averageProcessingTime)}
								</div>
							</div>
						</div>

						{/* Performance Metrics */}
						<div>
							<h4 style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#e2e8f0" }}>
								Performance Metrics
							</h4>
							<div style={{ fontSize: "12px", color: "#94a3b8", lineHeight: "1.4" }}>
								<div>
									<strong>Throughput:</strong> {profileData.metrics.throughput.toFixed(1)} tasks/hr
								</div>
								<div>
									<strong>Success Rate:</strong> {profileData.metrics.successRate.toFixed(1)}%
								</div>
								<div>
									<strong>Error Rate:</strong> {profileData.metrics.errorRate.toFixed(1)}%
								</div>
								<div>
									<strong>Queue Wait:</strong> {formatDuration(profileData.metrics.queueWaitTime)}
								</div>
							</div>
						</div>

						{/* Task History */}
						<div>
							<h4 style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#e2e8f0" }}>
								Task History
							</h4>
							<div style={{ fontSize: "12px", color: "#94a3b8", lineHeight: "1.4" }}>
								<div>
									<strong>Completed:</strong> {profileData.state.completedTasks}
								</div>
								<div>
									<strong>Failed:</strong> {profileData.state.failedTasks}
								</div>
								<div>
									<strong>Total Processed:</strong>{" "}
									{profileData.state.completedTasks + profileData.state.failedTasks}
								</div>
							</div>
						</div>
					</div>

					{/* Controls */}
					<div
						style={{
							marginTop: "16px",
							paddingTop: "16px",
							borderTop: "1px solid #374151",
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
						}}
					>
						<div style={{ fontSize: "12px", color: "#6b7280" }}>
							Profile: {profileData.profile.name}
						</div>
						<button
							type="button"
							onClick={() =>
								toggleProfileStatus(profileData.profile.name, !profileData.state.isActive)
							}
							style={{
								padding: "6px 12px",
								borderRadius: "6px",
								border: "none",
								fontSize: "12px",
								fontWeight: "500",
								cursor: "pointer",
								backgroundColor: profileData.state.isActive ? "#ef4444" : "#10b981",
								color: "white",
							}}
						>
							{profileData.state.isActive ? "Disable" : "Enable"}
						</button>
					</div>
				</SectionCard>
			))}
		</div>
	);
}
