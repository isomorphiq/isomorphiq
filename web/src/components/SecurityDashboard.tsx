import type React from "react";
import { useState } from "react";

interface SecurityDashboardProps {
	dashboardData: {
		summary: {
			totalUsers: number;
			activeSessions: number;
			failedLogins24h: number;
			openAlerts: number;
			complianceScore: number;
		};
		topRisks: Array<{
			type: string;
			count: number;
			severity: string;
		}>;
		complianceStatus: Array<{
			framework: string;
			requirements: {
				compliant: number;
				total: number;
			};
			status: string;
		}>;
		recentAlerts: Array<{
			id: string;
			type: string;
			severity: string;
			title: string;
			description: string;
			timestamp: string;
			status: string;
		}>;
		recentAuditLogs: Array<{
			id: string;
			userId: string;
			action: string;
			resource: string;
			outcome: string;
			timestamp: string;
		}>;
	};
	onCreateAlert?: (alert: CreateSecurityAlertInput) => void;
}

interface CreateSecurityAlertInput {
	type: string;
	severity: "low" | "medium" | "high" | "critical";
	title: string;
	description: string;
	details: Record<string, unknown>;
}

interface SecurityAlert {
	id: string;
	type: string;
	severity: string;
	title: string;
	description: string;
	timestamp: string;
	status: string;
}

export const SecurityDashboard: React.FC<SecurityDashboardProps> = ({
	dashboardData,
	onCreateAlert,
}) => {
	const [activeTab, setActiveTab] = useState<"overview" | "alerts" | "audit" | "policies">(
		"overview",
	);
	const [_selectedAlert, setSelectedAlert] = useState<SecurityAlert | null>(null);
	const [showCreateAlert, setShowCreateAlert] = useState(false);
	const [newAlert, setNewAlert] = useState<CreateSecurityAlertInput>({
		type: "suspicious_activity",
		severity: "medium",
		title: "",
		description: "",
		details: {},
	});

	const getSeverityColor = (level: string) => {
		switch (level) {
			case "critical":
				return "text-red-600";
			case "high":
				return "text-red-500";
			case "medium":
				return "text-yellow-600";
			case "low":
				return "text-green-600";
			default:
				return "text-gray-600";
		}
	};

	const getRiskLevelColor = (level: string) => {
		switch (level) {
			case "critical":
				return "text-red-600";
			case "high":
				return "text-red-500";
			case "medium":
				return "text-yellow-600";
			case "low":
				return "text-green-600";
			default:
				return "text-gray-600";
		}
	};

	const handleCreateAlert = () => {
		if (onCreateAlert && newAlert.title && newAlert.description) {
			onCreateAlert(newAlert);
			setNewAlert({
				type: "suspicious_activity",
				severity: "medium",
				title: "",
				description: "",
				details: {},
			});
			setShowCreateAlert(false);
		}
	};

	const formatDate = (dateString: string) => {
		return new Date(dateString).toLocaleString();
	};

	return (
		<div className="min-h-screen bg-gray-50 p-6">
			<div className="max-w-7xl mx-auto">
				{/* Header */}
				<div className="mb-8">
					<h1 className="text-3xl font-bold text-gray-900 mb-2">Security & Compliance Center</h1>
					<p className="text-gray-600">
						Monitor security posture, manage compliance, and respond to threats
					</p>
				</div>

				{/* Summary Cards */}
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
					<div className="bg-white rounded-lg shadow p-6">
						<div className="text-2xl font-bold text-gray-900">
							{dashboardData.summary.totalUsers}
						</div>
						<div className="text-sm text-gray-600">Total Users</div>
					</div>
					<div className="bg-white rounded-lg shadow p-6">
						<div className="text-2xl font-bold text-gray-900">
							{dashboardData.summary.activeSessions}
						</div>
						<div className="text-sm text-gray-600">Active Sessions</div>
					</div>
					<div className="bg-white rounded-lg shadow p-6">
						<div className="text-2xl font-bold text-red-600">
							{dashboardData.summary.failedLogins24h}
						</div>
						<div className="text-sm text-gray-600">Failed Logins (24h)</div>
					</div>
					<div className="bg-white rounded-lg shadow p-6">
						<div className="text-2xl font-bold text-yellow-600">
							{dashboardData.summary.openAlerts}
						</div>
						<div className="text-sm text-gray-600">Open Alerts</div>
					</div>
					<div className="bg-white rounded-lg shadow p-6">
						<div className="text-2xl font-bold text-green-600">
							{dashboardData.summary.complianceScore}%
						</div>
						<div className="text-sm text-gray-600">Compliance Score</div>
					</div>
				</div>

				{/* Navigation Tabs */}
				<div className="bg-white rounded-lg shadow mb-6">
					<div className="border-b border-gray-200">
						<nav className="-mb-px flex space-x-8">
							{["overview", "alerts", "audit", "policies"].map((tab) => (
								<button
									type="button"
									key={tab}
									onClick={() => setActiveTab(tab as "overview" | "alerts" | "audit" | "policies")}
									className={`py-4 px-1 border-b-2 font-medium text-sm ${
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
				</div>

				{/* Tab Content */}
				<div className="bg-white rounded-lg shadow p-6">
					{activeTab === "overview" && (
						<div>
							<h2 className="text-xl font-semibold text-gray-900 mb-6">Security Overview</h2>

							{/* Top Risks */}
							<div className="mb-8">
								<h3 className="text-lg font-medium text-gray-900 mb-4">Top Security Risks</h3>
								<div className="space-y-3">
									{dashboardData.topRisks?.map((risk, index) => (
										<div
											key={`risk-${risk.type || index}`}
											className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
										>
											<div>
												<div className="font-medium text-gray-900">{risk.type}</div>
												<div className="text-sm text-gray-600">{risk.count} occurrences</div>
											</div>
											<span
												className={`px-2 py-1 text-xs font-medium rounded-full ${getSeverityColor(
													risk.severity,
												)}`}
											>
												{risk.severity.toUpperCase()}
											</span>
										</div>
									))}
								</div>
							</div>

							{/* Compliance Status */}
							<div className="mb-8">
								<h3 className="text-lg font-medium text-gray-900 mb-4">Compliance Status</h3>
								<div className="space-y-3">
									{dashboardData.complianceStatus?.map((framework, index) => (
										<div
											key={`framework-${framework.framework || index}`}
											className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
										>
											<div>
												<div className="font-medium text-gray-900">{framework.framework}</div>
												<div className="text-sm text-gray-600">
													{framework.requirements.compliant}/{framework.requirements.total}{" "}
													requirements
												</div>
											</div>
											<span
												className={`px-2 py-1 text-xs font-medium rounded-full ${
													framework.status === "compliant"
														? "bg-green-100 text-green-800"
														: "bg-yellow-100 text-yellow-800"
												}`}
											>
												{framework.status.toUpperCase()}
											</span>
										</div>
									))}
								</div>
							</div>
						</div>
					)}

					{activeTab === "alerts" && (
						<div>
							<div className="flex justify-between items-center mb-6">
								<h2 className="text-xl font-semibold text-gray-900">Security Alerts</h2>
								<button
									type="button"
									onClick={() => setShowCreateAlert(true)}
									className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
								>
									Create Alert
								</button>
							</div>

							{/* Create Alert Modal */}
							{showCreateAlert && (
								<div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
									<div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
										<div className="mt-3">
											<h3 className="text-lg font-medium text-gray-900 mb-4">
												Create Security Alert
											</h3>
											<div className="space-y-4">
												<div>
													<label
														htmlFor="alert-type"
														className="block text-sm font-medium text-gray-700"
													>
														Alert Type
													</label>
													<select
														id="alert-type"
														value={newAlert.type}
														onChange={(e) => setNewAlert({ ...newAlert, type: e.target.value })}
														className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
													>
														<option value="suspicious_activity">Suspicious Activity</option>
														<option value="brute_force_attack">Brute Force Attack</option>
														<option value="data_breach_attempt">Data Breach Attempt</option>
														<option value="unauthorized_access">Unauthorized Access</option>
														<option value="compliance_violation">Compliance Violation</option>
													</select>
												</div>
												<div>
													<label
														htmlFor="alert-severity"
														className="block text-sm font-medium text-gray-700"
													>
														Severity
													</label>
													<select
														id="alert-severity"
														value={newAlert.severity}
														onChange={(e) =>
															setNewAlert({
																...newAlert,
																severity: e.target.value as "low" | "medium" | "high" | "critical",
															})
														}
														className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
													>
														<option value="low">Low</option>
														<option value="medium">Medium</option>
														<option value="high">High</option>
														<option value="critical">Critical</option>
													</select>
												</div>
												<div>
													<label
														htmlFor="alert-title-input"
														className="block text-sm font-medium text-gray-700"
													>
														Title
													</label>
													<input
														id="alert-title-input"
														type="text"
														value={newAlert.title}
														onChange={(e) => setNewAlert({ ...newAlert, title: e.target.value })}
														className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
													/>
												</div>
												<div>
													<label
														htmlFor="alert-description"
														className="block text-sm font-medium text-gray-700"
													>
														Description
													</label>
													<textarea
														id="alert-description"
														value={newAlert.description}
														onChange={(e) =>
															setNewAlert({ ...newAlert, description: e.target.value })
														}
														rows={3}
														className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
													/>
												</div>
											</div>
											<div className="flex justify-end space-x-3 mt-6">
												<button
													type="button"
													onClick={() => setShowCreateAlert(false)}
													className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400"
												>
													Cancel
												</button>
												<button
													type="button"
													onClick={handleCreateAlert}
													className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
												>
													Create Alert
												</button>
											</div>
										</div>
									</div>
								</div>
							)}

							{/* Alerts List */}
							<div className="space-y-4">
								{dashboardData.recentAlerts?.map((alert) => (
									<button
										type="button"
										key={alert.id}
										className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer"
										onClick={() => setSelectedAlert(alert)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												setSelectedAlert(alert);
											}
										}}
									>
										<div className="flex items-start justify-between">
											<div className="flex-1">
												<div className="flex items-center space-x-2">
													<h4 className="text-lg font-medium text-gray-900">{alert.title}</h4>
													<span
														className={`px-2 py-1 text-xs font-medium rounded-full ${getSeverityColor(
															alert.severity,
														)}`}
													>
														{alert.severity.toUpperCase()}
													</span>
												</div>
												<p className="text-gray-600 mt-1">{alert.description}</p>
												<div className="text-sm text-gray-500 mt-2">
													{formatDate(alert.timestamp)}
												</div>
											</div>
											<span
												className={`px-2 py-1 text-xs font-medium rounded ${
													alert.status === "open"
														? "bg-red-100 text-red-800"
														: alert.status === "resolved"
															? "bg-green-100 text-green-800"
															: "bg-yellow-100 text-yellow-800"
												}`}
											>
												{alert.status.replace("_", " ").toUpperCase()}
											</span>
										</div>
									</button>
								))}
							</div>
						</div>
					)}

					{activeTab === "audit" && (
						<div>
							<h2 className="text-xl font-semibold text-gray-900 mb-6">Audit Logs</h2>
							<div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
								<table className="min-w-full divide-y divide-gray-300">
									<thead className="bg-gray-50">
										<tr>
											<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
												Timestamp
											</th>
											<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
												User
											</th>
											<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
												Action
											</th>
											<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
												Resource
											</th>
											<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
												Outcome
											</th>
											<th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
												Risk Level
											</th>
										</tr>
									</thead>
									<tbody className="bg-white divide-y divide-gray-200">
										{dashboardData.recentAuditLogs?.map((log) => (
											<tr key={log.id}>
												<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
													{formatDate(log.timestamp)}
												</td>
												<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
													{log.userId || "System"}
												</td>
												<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
													{log.action}
												</td>
												<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
													{log.resource}
												</td>
												<td className="px-6 py-4 whitespace-nowrap text-sm">
													<span
														className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
															log.outcome === "success"
																? "bg-green-100 text-green-800"
																: "bg-red-100 text-red-800"
														}`}
													>
														{(log.outcome || "").toUpperCase()}
													</span>
												</td>
												<td className="px-6 py-4 whitespace-nowrap text-sm">
													<span className={`font-medium ${getRiskLevelColor(log.outcome)}`}>
														{(log.outcome || "").toUpperCase()}
													</span>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}

					{activeTab === "policies" && (
						<div>
							<h2 className="text-xl font-semibold text-gray-900 mb-6">Security Policies</h2>
							<div className="text-gray-600">
								<p>
									Security policies define the rules and configurations that govern how your system
									protects data and manages access.
								</p>
								<p className="mt-2">
									Current policies include password requirements, session management, data
									encryption, and compliance frameworks (GDPR, SOC2).
								</p>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};
