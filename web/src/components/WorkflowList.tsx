import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { WorkflowDefinition, WorkflowStatistics } from "../../../src/types/workflow-types.ts";
import { WorkflowEditor } from "./WorkflowEditor.tsx";

type WorkflowListProps = Record<string, never>;

export const WorkflowList: React.FC<WorkflowListProps> = () => {
	const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [filterCategory, setFilterCategory] = useState<string>("");
	const [filterEnabled, setFilterEnabled] = useState<string>("");
	const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowDefinition | null>(null);
	const [showEditor, setShowEditor] = useState(false);
	const [statistics, setStatistics] = useState<Record<string, WorkflowStatistics>>({});

	// Fetch workflows
	const fetchWorkflows = useCallback(async () => {
		try {
			const params = new URLSearchParams();
			if (filterCategory) params.append("category", filterCategory);
			if (filterEnabled) params.append("enabled", filterEnabled);

			const response = await fetch(`/api/workflows?${params}`);
			const result = await response.json();

			if (result.success) {
				setWorkflows(result.data);

				// Fetch statistics for each workflow
				const statsPromises = result.data.map(async (workflow: WorkflowDefinition) => {
					const statsResponse = await fetch(`/api/workflows/${workflow.id}/statistics`);
					const statsResult = await statsResponse.json();
					return { workflowId: workflow.id, stats: statsResult.data };
				});

				const statsResults = await Promise.all(statsPromises);
				const statsMap = statsResults.reduce(
					(acc, { workflowId, stats }) => {
						acc[workflowId] = stats;
						return acc;
					},
					{} as Record<string, WorkflowStatistics>,
				);

				setStatistics(statsMap);
			} else {
				setError("Failed to load workflows");
			}
		} catch (_err) {
			setError("Error loading workflows");
		} finally {
			setLoading(false);
		}
	}, [filterCategory, filterEnabled]);

	useEffect(() => {
		fetchWorkflows();
	}, [fetchWorkflows]);

	// Handle workflow create
	const handleCreateWorkflow = () => {
		setSelectedWorkflow(null);
		setShowEditor(true);
	};

	// Handle workflow edit
	const handleEditWorkflow = (workflow: WorkflowDefinition) => {
		setSelectedWorkflow(workflow);
		setShowEditor(true);
	};

	// Handle workflow save
	const handleSaveWorkflow = (_workflow: WorkflowDefinition) => {
		setShowEditor(false);
		setSelectedWorkflow(null);

		// Refresh workflows list
		fetchWorkflows();
	};

	// Handle workflow delete
	const handleDeleteWorkflow = async (workflow: WorkflowDefinition) => {
		if (!confirm(`Are you sure you want to delete "${workflow.name}"?`)) {
			return;
		}

		try {
			const response = await fetch(`/api/workflows/${workflow.id}`, {
				method: "DELETE",
			});

			const result = await response.json();
			if (result.success) {
				setWorkflows((prev: WorkflowDefinition[]) =>
					prev.filter((w: WorkflowDefinition) => w.id !== workflow.id),
				);
			} else {
				setError("Failed to delete workflow");
			}
		} catch (_err) {
			setError("Error deleting workflow");
		}
	};

	// Handle workflow execute
	const handleExecuteWorkflow = async (workflow: WorkflowDefinition) => {
		try {
			const response = await fetch(`/api/workflows/${workflow.id}/execute`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ triggerData: {} }),
			});

			const result = await response.json();
			if (result.success) {
				alert(`Workflow execution started: ${result.data.id}`);
			} else {
				setError("Failed to execute workflow");
			}
		} catch (_err) {
			setError("Error executing workflow");
		}
	};

	// Toggle workflow enabled state
	const handleToggleEnabled = async (workflow: WorkflowDefinition) => {
		try {
			const response = await fetch(`/api/workflows/${workflow.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: !workflow.enabled }),
			});

			const result = await response.json();
			if (result.success) {
				setWorkflows((prev: WorkflowDefinition[]) =>
					prev.map((w: WorkflowDefinition) =>
						w.id === workflow.id ? { ...w, enabled: !w.enabled } : w,
					),
				);
			} else {
				setError("Failed to update workflow");
			}
		} catch (_err) {
			setError("Error updating workflow");
		}
	};

	// Filter workflows
	const filteredWorkflows = workflows.filter((workflow: WorkflowDefinition) => {
		const matchesSearch =
			!search ||
			workflow.name.toLowerCase().includes(search.toLowerCase()) ||
			workflow.description.toLowerCase().includes(search.toLowerCase());

		return matchesSearch;
	});

	if (showEditor) {
		return (
			<WorkflowEditor
				workflow={selectedWorkflow || undefined}
				onSave={handleSaveWorkflow}
				onCancel={() => setShowEditor(false)}
			/>
		);
	}

	if (loading) {
		return (
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
					height: "100vh",
				}}
			>
				<div>Loading workflows...</div>
			</div>
		);
	}

	return (
		<div style={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column" }}>
			{/* Header */}
			<div
				style={{
					background: "white",
					borderBottom: "1px solid #e5e7eb",
					padding: "20px",
				}}
			>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: 20,
					}}
				>
					<h1 style={{ margin: 0, fontSize: "24px", fontWeight: "bold" }}>Workflow Automation</h1>
					<button
						type="button"
						onClick={handleCreateWorkflow}
						style={{
							padding: "10px 20px",
							border: "none",
							borderRadius: 6,
							background: "#3b82f6",
							color: "white",
							cursor: "pointer",
							fontWeight: "bold",
						}}
					>
						Create Workflow
					</button>
				</div>

				{/* Filters */}
				<div style={{ display: "flex", gap: 15, alignItems: "center" }}>
					<input
						type="text"
						placeholder="Search workflows..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						style={{
							flex: 1,
							maxWidth: 400,
							border: "1px solid #e5e7eb",
							borderRadius: 4,
							padding: "8px 12px",
						}}
					/>

					<select
						value={filterCategory}
						onChange={(e) => setFilterCategory(e.target.value)}
						style={{
							border: "1px solid #e5e7eb",
							borderRadius: 4,
							padding: "8px 12px",
						}}
					>
						<option value="">All Categories</option>
						<option value="task_management">Task Management</option>
						<option value="approval">Approval</option>
						<option value="notification">Notification</option>
						<option value="integration">Integration</option>
						<option value="scheduling">Scheduling</option>
						<option value="custom">Custom</option>
					</select>

					<select
						value={filterEnabled}
						onChange={(e) => setFilterEnabled(e.target.value)}
						style={{
							border: "1px solid #e5e7eb",
							borderRadius: 4,
							padding: "8px 12px",
						}}
					>
						<option value="">All Status</option>
						<option value="true">Enabled</option>
						<option value="false">Disabled</option>
					</select>
				</div>
			</div>

			{/* Error message */}
			{error && (
				<div
					style={{
						background: "#fef2f2",
						border: "1px solid #fecaca",
						color: "#dc2626",
						padding: "12px 20px",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
					}}
				>
					<span>{error}</span>
					<button
						type="button"
						onClick={() => setError(null)}
						style={{ background: "none", border: "none", cursor: "pointer" }}
					>
						×
					</button>
				</div>
			)}

			{/* Workflow list */}
			<div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
				{filteredWorkflows.length === 0 ? (
					<div style={{ textAlign: "center", color: "#6b7280", marginTop: 50 }}>
						{search || filterCategory || filterEnabled
							? "No workflows found matching your filters."
							: "No workflows created yet. Create your first workflow to get started."}
					</div>
				) : (
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
							gap: 20,
						}}
					>
						{filteredWorkflows.map((workflow: WorkflowDefinition) => {
							const stats = statistics[workflow.id];
							return (
								<div
									key={workflow.id}
									style={{
										border: "1px solid #e5e7eb",
										borderRadius: 8,
										padding: 20,
										background: "white",
										boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
									}}
								>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "start",
											marginBottom: 10,
										}}
									>
										<div style={{ flex: 1 }}>
											<h3
												style={{ margin: 0, fontSize: "16px", fontWeight: "bold", marginBottom: 5 }}
											>
												{workflow.name}
											</h3>
											<span
												style={{
													display: "inline-block",
													padding: "2px 8px",
													borderRadius: 12,
													fontSize: "12px",
													background: workflow.enabled ? "#dcfce7" : "#fef2f2",
													color: workflow.enabled ? "#166534" : "#dc2626",
												}}
											>
												{workflow.enabled ? "Enabled" : "Disabled"}
											</span>
										</div>
									</div>

									<p
										style={{
											color: "#6b7280",
											fontSize: "14px",
											margin: "10px 0",
											lineHeight: "1.4",
										}}
									>
										{workflow.description || "No description"}
									</p>

									<div style={{ fontSize: "12px", color: "#6b7280", marginBottom: 15 }}>
										<div>Category: {workflow.category}</div>
										<div>Nodes: {workflow.nodes?.length || 0}</div>
										{stats && (
											<div>
												Executions: {stats.totalExecutions}
												{stats.totalExecutions > 0 && (
													<span>
														{" "}
														(
														{Math.round((stats.successfulExecutions / stats.totalExecutions) * 100)}
														% success)
													</span>
												)}
											</div>
										)}
									</div>

									<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
										<button
											type="button"
											onClick={() => handleEditWorkflow(workflow)}
											style={{
												padding: "6px 12px",
												border: "1px solid #e5e7eb",
												borderRadius: 4,
												background: "white",
												cursor: "pointer",
												fontSize: "12px",
											}}
										>
											Edit
										</button>

										<button
											type="button"
											onClick={() => handleExecuteWorkflow(workflow)}
											disabled={!workflow.enabled}
											style={{
												padding: "6px 12px",
												border: "1px solid #10b981",
												borderRadius: 4,
												background: workflow.enabled ? "#10b981" : "#e5e7eb",
												color: workflow.enabled ? "white" : "#6b7280",
												cursor: workflow.enabled ? "pointer" : "not-allowed",
												fontSize: "12px",
											}}
										>
											Run
										</button>

										<button
											type="button"
											onClick={() => handleToggleEnabled(workflow)}
											style={{
												padding: "6px 12px",
												border: "1px solid #f59e0b",
												borderRadius: 4,
												background: "white",
												color: "#f59e0b",
												cursor: "pointer",
												fontSize: "12px",
											}}
										>
											{workflow.enabled ? "Disable" : "Enable"}
										</button>

										<button
											type="button"
											onClick={() => handleDeleteWorkflow(workflow)}
											style={{
												padding: "6px 12px",
												border: "1px solid #ef4444",
												borderRadius: 4,
												background: "white",
												color: "#ef4444",
												cursor: "pointer",
												fontSize: "12px",
											}}
										>
											Delete
										</button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
};
