import type React from "react";
import { useCallback, useEffect, useState } from "react";

interface SchedulingMetrics {
	teamId: string;
	date: string;
	totalTasks: number;
	assignedTasks: number;
	unassignedTasks: number;
	averageUtilization: number;
	skillUtilization: Record<string, number>;
	workloadDistribution: Record<string, number>;
	conflictRate: number;
	completionRate: number;
	averageTaskDuration: number;
}

interface Workload {
	userId: string;
	username: string;
	currentTasks: number;
	estimatedHours: number;
	availableHours: number;
	utilizationRate: number;
	overloaded: boolean;
}

interface ScheduleConflict {
	id: string;
	type: string;
	taskId: string;
	userId: string;
	description: string;
	severity: "low" | "medium" | "high" | "critical";
	detectedAt: string;
	resolution?: {
		strategy: string;
		proposedSolution: string;
		requiresApproval: boolean;
	};
}

export const SchedulingDashboard: React.FC = () => {
	const [loading, setLoading] = useState<boolean>(false);
	const [error, setError] = useState<string>("");
	const [metrics, setMetrics] = useState<SchedulingMetrics | null>(null);
	const [workloads, setWorkloads] = useState<Workload[]>([]);
	const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
	const [activeTab, setActiveTab] = useState<"overview" | "workloads" | "conflicts">("overview");

	const fetchSchedulingData = useCallback(async () => {
		try {
			setLoading(true);

			// Fetch metrics
			const metricsResponse = await fetch("/api/schedule/metrics");
			const metricsData = await metricsResponse.json();

			// Fetch workloads
			const workloadsResponse = await fetch("/api/schedule/workloads");
			const workloadsData = await workloadsResponse.json();

			// Fetch conflicts
			const conflictsResponse = await fetch("/api/schedule/conflicts");
			const conflictsData = await conflictsResponse.json();

			if (metricsData.success && workloadsData.success && conflictsData.success) {
				// Enrich workloads with user data
				const enrichedWorkloads = await Promise.all(
					workloadsData.data.map(async (workload: { userId: string; [key: string]: unknown }) => {
						const userResponse = await fetch(`/api/users/${workload.userId}`);
						const userData = await userResponse.json();

						return {
							...workload,
							username: userData.user?.username || `User ${workload.userId}`,
						};
					}),
				);

				setMetrics(metricsData.data);
				setWorkloads(enrichedWorkloads);
				setConflicts(conflictsData.data);
			} else {
				setError("Failed to load scheduling data");
			}
		} catch (_err) {
			setError("Error loading scheduling data");
		} finally {
			setLoading(false);
		}
	}, []);

	const handleAutoAssign = async () => {
		try {
			const response = await fetch("/api/schedule/auto-assign", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${localStorage.getItem("token")}`,
				},
				body: JSON.stringify({}),
			});

			const data = await response.json();

			if (data.success) {
				// Refresh data after assignment
				fetchSchedulingData();
				alert(`Successfully assigned ${data.data.metrics.tasksAssigned} tasks`);
			} else {
				alert("Auto-assignment failed");
			}
		} catch (_err) {
			alert("Error during auto-assignment");
		}
	};

	const handleOptimizeSchedule = async () => {
		try {
			const response = await fetch("/api/schedule/optimize", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${localStorage.getItem("token")}`,
				},
				body: JSON.stringify({}),
			});

			const data = await response.json();

			if (data.success) {
				// Refresh data after optimization
				fetchSchedulingData();
				alert(`Schedule optimized: ${data.data.improvements.join(", ")}`);
			} else {
				alert("Schedule optimization failed");
			}
		} catch (_err) {
			alert("Error during schedule optimization");
		}
	};

	const getUtilizationColor = (utilization: number) => {
		if (utilization >= 90) return "text-red-600";
		if (utilization >= 75) return "text-yellow-600";
		return "text-green-600";
	};

	const getSeverityColor = (severity: string) => {
		switch (severity) {
			case "critical":
				return "bg-red-100 text-red-800 border-red-200";
			case "high":
				return "bg-orange-100 text-orange-800 border-orange-200";
			case "medium":
				return "bg-yellow-100 text-yellow-800 border-yellow-200";
			case "low":
				return "bg-blue-100 text-blue-800 border-blue-200";
			default:
				return "bg-gray-100 text-gray-800 border-gray-200";
		}
	};

	useEffect(() => {
		fetchSchedulingData();
	}, [fetchSchedulingData]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
				<span className="ml-2">Loading scheduling data...</span>
			</div>
		);
	}

	if (error) {
		return <div className="text-center text-red-600 p-8">{error}</div>;
	}

	return (
		<div className="p-6">
			<div className="mb-6">
				<h1 className="text-2xl font-bold mb-2">Scheduling Dashboard</h1>
				<p className="text-gray-600">Automated task scheduling and resource allocation overview</p>
			</div>

			{/* Action Buttons */}
			<div className="mb-6 flex space-x-4">
				<button
					type="button"
					onClick={handleAutoAssign}
					className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
				>
					Auto-Assign Tasks
				</button>
				<button
					type="button"
					onClick={handleOptimizeSchedule}
					className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
				>
					Optimize Schedule
				</button>
				<button
					type="button"
					onClick={fetchSchedulingData}
					className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
				>
					Refresh
				</button>
			</div>

			{/* Tabs */}
			<div className="border-b border-gray-200 mb-6">
				<nav className="-mb-px flex space-x-8">
					{["overview", "workloads", "conflicts"].map((tab) => (
						<button
							key={tab}
							type="button"
							onClick={() => setActiveTab(tab as "overview" | "workloads" | "conflicts")}
							className={`py-2 px-1 border-b-2 font-medium text-sm ${
								activeTab === tab
									? "border-blue-500 text-blue-600"
									: "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
							}`}
						>
							{tab.charAt(0).toUpperCase() + tab.slice(1)}
						</button>
					))}
				</nav>
			</div>

			{/* Tab Content */}
			{activeTab === "overview" && metrics && (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
					<div className="bg-white p-6 rounded-lg shadow">
						<h3 className="text-sm font-medium text-gray-500 mb-2">Total Tasks</h3>
						<p className="text-2xl font-bold">{metrics.totalTasks}</p>
					</div>
					<div className="bg-white p-6 rounded-lg shadow">
						<h3 className="text-sm font-medium text-gray-500 mb-2">Assigned Tasks</h3>
						<p className="text-2xl font-bold text-green-600">{metrics.assignedTasks}</p>
					</div>
					<div className="bg-white p-6 rounded-lg shadow">
						<h3 className="text-sm font-medium text-gray-500 mb-2">Unassigned Tasks</h3>
						<p className="text-2xl font-bold text-orange-600">{metrics.unassignedTasks}</p>
					</div>
					<div className="bg-white p-6 rounded-lg shadow">
						<h3 className="text-sm font-medium text-gray-500 mb-2">Avg Utilization</h3>
						<p className={`text-2xl font-bold ${getUtilizationColor(metrics.averageUtilization)}`}>
							{metrics.averageUtilization.toFixed(1)}%
						</p>
					</div>
				</div>
			)}

			{activeTab === "workloads" && (
				<div className="bg-white rounded-lg shadow">
					<div className="px-6 py-4 border-b border-gray-200">
						<h2 className="text-lg font-semibold">Team Workloads</h2>
					</div>
					<div className="overflow-x-auto">
						<table className="min-w-full divide-y divide-gray-200">
							<thead className="bg-gray-50">
								<tr>
									<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										User
									</th>
									<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										Current Tasks
									</th>
									<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										Estimated Hours
									</th>
									<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										Available Hours
									</th>
									<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										Utilization
									</th>
									<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										Status
									</th>
								</tr>
							</thead>
							<tbody className="bg-white divide-y divide-gray-200">
								{workloads.map((workload) => (
									<tr key={workload.userId}>
										<td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
											{workload.username}
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
											{workload.currentTasks}
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
											{workload.estimatedHours}
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
											{workload.availableHours}
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-sm">
											<span
												className={`font-medium ${getUtilizationColor(workload.utilizationRate)}`}
											>
												{workload.utilizationRate.toFixed(1)}%
											</span>
										</td>
										<td className="px-6 py-4 whitespace-nowrap">
											<span
												className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
													workload.overloaded
														? "bg-red-100 text-red-800"
														: "bg-green-100 text-green-800"
												}`}
											>
												{workload.overloaded ? "Overloaded" : "Available"}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{activeTab === "conflicts" && (
				<div className="bg-white rounded-lg shadow">
					<div className="px-6 py-4 border-b border-gray-200">
						<h2 className="text-lg font-semibold">Schedule Conflicts ({conflicts.length})</h2>
					</div>
					{conflicts.length === 0 ? (
						<div className="p-6 text-center text-gray-500">No schedule conflicts detected.</div>
					) : (
						<div className="divide-y divide-gray-200">
							{conflicts.map((conflict) => (
								<div key={conflict.id} className="p-6">
									<div className="flex justify-between items-start mb-2">
										<div>
											<h3 className="font-medium text-gray-900">{conflict.description}</h3>
											<p className="text-sm text-gray-500 mt-1">
												Task: {conflict.taskId} | User: {conflict.userId}
											</p>
										</div>
										<div className="flex items-center space-x-2">
											<span
												className={`px-2 py-1 text-xs font-medium rounded-full border ${getSeverityColor(conflict.severity)}`}
											>
												{conflict.severity.toUpperCase()}
											</span>
											<span className="text-xs text-gray-500">
												{new Date(conflict.detectedAt).toLocaleDateString()}
											</span>
										</div>
									</div>
									{conflict.resolution && (
										<div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded">
											<p className="text-sm">
												<strong>Resolution:</strong> {conflict.resolution.proposedSolution}
											</p>
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
};
