import type React from "react";
import { useEffect, useState } from "react";
import type {
	WorkflowCategory,
	WorkflowVariable,
	WorkflowDefinition,
	WorkflowNodeType,
} from "../../../src/types.ts";
import { WorkflowBuilder, type WorkflowNodeTypeConfig } from "./WorkflowBuilder.tsx";

interface WorkflowEditorProps {
	workflow?: WorkflowDefinition;
	onSave?: (workflow: WorkflowDefinition) => void;
	onCancel?: () => void;
	readonly?: boolean;
}

export const WorkflowEditor: React.FC<WorkflowEditorProps> = ({
	workflow,
	onSave,
	onCancel,
	readonly = false,
}) => {
	const [currentWorkflow, setCurrentWorkflow] = useState<WorkflowDefinition>(
		workflow || {
			id: `workflow_${Date.now()}`,
			name: "",
			description: "",
			version: "1.0.0",
			category: "custom",
			nodes: [],
			connections: [],
			variables: [],
			settings: {
				timeout: 300,
				errorHandling: "stop",
				logging: { enabled: true, level: "info", includeData: false },
			},
			metadata: {
				tags: [],
				author: "user",
			},
			enabled: true,
			createdAt: new Date(),
			updatedAt: new Date(),
			createdBy: "user",
			updatedBy: "user",
		},
	);
	const [nodeTypes, setNodeTypes] = useState<WorkflowNodeTypeConfig[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<"builder" | "settings" | "variables">("builder");
	const nodeTypeThemes: Record<WorkflowNodeType, { label: string; icon: string; color: string }> =
		{
			trigger: { label: "Trigger", icon: "!", color: "#f59e0b" },
			condition: { label: "Condition", icon: "?", color: "#0ea5e9" },
			action: { label: "Action", icon: ">", color: "#22c55e" },
			delay: { label: "Delay", icon: "~", color: "#f97316" },
			branch: { label: "Branch", icon: "/", color: "#a855f7" },
			merge: { label: "Merge", icon: "+", color: "#14b8a6" },
			notification: { label: "Notification", icon: "N", color: "#38bdf8" },
			task_create: { label: "Create Task", icon: "C", color: "#4f46e5" },
			task_update: { label: "Update Task", icon: "U", color: "#06b6d4" },
			task_assign: { label: "Assign Task", icon: "A", color: "#8b5cf6" },
			webhook: { label: "Webhook", icon: "W", color: "#64748b" },
			script: { label: "Script", icon: "S", color: "#0f172a" },
		};
	const isWorkflowNodeType = (value: string): value is WorkflowNodeType =>
		Object.prototype.hasOwnProperty.call(nodeTypeThemes, value);

	// Fetch node types
	useEffect(() => {
		const fetchNodeTypes = async () => {
			try {
				const response = await fetch("/api/workflow-node-types");
				const result = await response.json();

				if (result.success && Array.isArray(result.data)) {
					const normalized = result.data
						.filter((node) => node && typeof node === "object" && "type" in node)
						.map((node) => {
							const raw = node as {
								type: string;
								name?: string;
								description?: string;
								inputs?: WorkflowNodeTypeConfig["inputs"];
								outputs?: WorkflowNodeTypeConfig["outputs"];
								parameters?: WorkflowNodeTypeConfig["parameters"];
							};
							const type = isWorkflowNodeType(raw.type) ? raw.type : "action";
							const theme = nodeTypeThemes[type];
							return {
								type,
								label: raw.name?.trim() || theme.label,
								description: raw.description,
								icon: theme.icon,
								color: theme.color,
								inputs: raw.inputs ?? [],
								outputs: raw.outputs ?? [],
								parameters: raw.parameters ?? [],
							} satisfies WorkflowNodeTypeConfig;
						});
					setNodeTypes(normalized);
				} else {
					setError("Failed to load node types");
				}
			} catch (_err) {
				setError("Error loading node types");
			} finally {
				setLoading(false);
			}
		};

		fetchNodeTypes();
	}, []);

	// Handle workflow change
	const handleWorkflowChange = (workflow: WorkflowDefinition) => {
		setCurrentWorkflow((prev) => ({
			...prev,
			...workflow,
			updatedAt: new Date(),
		}));
	};

	// Handle save
	const handleSave = async () => {
		if (!currentWorkflow.name.trim()) {
			setError("Workflow name is required");
			return;
		}

		try {
			let savedWorkflow: WorkflowDefinition;

			if (workflow) {
				// Update existing workflow
				const response = await fetch(`/api/workflows/${workflow.id}`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(currentWorkflow),
				});

				const result = await response.json();
				if (!result.success) {
					throw new Error(result.error || "Failed to update workflow");
				}

				savedWorkflow = result.data;
			} else {
				// Create new workflow
				const response = await fetch("/api/workflows", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(currentWorkflow),
				});

				const result = await response.json();
				if (!result.success) {
					throw new Error(result.error || "Failed to create workflow");
				}

				savedWorkflow = result.data;
			}

			onSave?.(savedWorkflow);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save workflow");
		}
	};

	// Handle node selection
	const _handleNodeSelect = (nodeId: string | null) => {
		// This would show node properties panel
		console.log("Selected node:", nodeId);
	};

	// Add variable
	const addVariable = () => {
		const newVariable = {
			name: `variable_${Date.now()}`,
			type: "string" as const,
			description: "",
			defaultValue: "",
			scope: "local" as const,
		};

		setCurrentWorkflow((prev) => ({
			...prev,
			variables: [...prev.variables, newVariable],
		}));
	};

	// Update variable
	const updateVariable = (index: number, updates: Partial<WorkflowVariable>) => {
		setCurrentWorkflow((prev) => ({
			...prev,
			variables: prev.variables.map((v, i) => (i === index ? { ...v, ...updates } : v)),
		}));
	};

	// Delete variable
	const deleteVariable = (index: number) => {
		setCurrentWorkflow((prev) => ({
			...prev,
			variables: prev.variables.filter((_, i) => i !== index),
		}));
	};

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
				<div>Loading workflow editor...</div>
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
					padding: "15px 20px",
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 20 }}>
					<input
						type="text"
						placeholder="Workflow Name"
						value={currentWorkflow.name}
						onChange={(e) => setCurrentWorkflow((prev) => ({ ...prev, name: e.target.value }))}
						disabled={readonly}
						style={{
							fontSize: "18px",
							fontWeight: "bold",
							border: "1px solid #e5e7eb",
							borderRadius: 4,
							padding: "8px 12px",
							minWidth: "300px",
						}}
					/>
					<span style={{ color: "#6b7280", fontSize: "14px" }}>
						Version: {currentWorkflow.version}
					</span>
				</div>

				<div style={{ display: "flex", gap: 10 }}>
					{!readonly && (
						<>
							<button
								type="button"
								onClick={onCancel}
								style={{
									padding: "8px 16px",
									border: "1px solid #e5e7eb",
									borderRadius: 6,
									background: "white",
									cursor: "pointer",
								}}
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleSave}
								style={{
									padding: "8px 16px",
									border: "none",
									borderRadius: 6,
									background: "#3b82f6",
									color: "white",
									cursor: "pointer",
									fontWeight: "bold",
								}}
							>
								Save
							</button>
						</>
					)}
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

			{/* Tabs */}
			<div
				style={{
					background: "white",
					borderBottom: "1px solid #e5e7eb",
					display: "flex",
					padding: "0 20px",
				}}
			>
				{["builder", "settings", "variables"].map((tab) => (
					<button
						key={tab}
						type="button"
						onClick={() => setActiveTab(tab as "builder" | "settings" | "variables")}
						style={{
							padding: "12px 20px",
							border: "none",
							background: "none",
							borderBottom: activeTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
							color: activeTab === tab ? "#3b82f6" : "#6b7280",
							cursor: "pointer",
							fontWeight: activeTab === tab ? "bold" : "normal",
							textTransform: "capitalize",
						}}
					>
						{tab}
					</button>
				))}
			</div>

			{/* Content */}
			<div style={{ flex: 1, overflow: "hidden" }}>
				{activeTab === "builder" && (
					<WorkflowBuilder
						workflow={currentWorkflow}
						onWorkflowChange={handleWorkflowChange}
						nodeTypes={nodeTypes}
						readonly={readonly}
					/>
				)}

				{activeTab === "settings" && (
					<div style={{ padding: "20px", background: "white", height: "100%" }}>
						<h3>Workflow Settings</h3>

						<div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 20 }}>
							<div>
								<label
									htmlFor="workflow-description"
									style={{ display: "block", marginBottom: 5, fontWeight: "bold" }}
								>
									Description
								</label>
								<textarea
									id="workflow-description"
									value={currentWorkflow.description}
									onChange={(e) =>
										setCurrentWorkflow((prev) => ({ ...prev, description: e.target.value }))
									}
									disabled={readonly}
									rows={3}
									style={{
										width: "100%",
										border: "1px solid #e5e7eb",
										borderRadius: 4,
										padding: "8px",
									}}
								/>
							</div>

							<div>
								<label
									htmlFor="workflow-category"
									style={{ display: "block", marginBottom: 5, fontWeight: "bold" }}
								>
									Category
								</label>
								<select
									id="workflow-category"
									value={currentWorkflow.category}
									onChange={(e) =>
										setCurrentWorkflow((prev) => ({
											...prev,
											category: e.target.value as WorkflowCategory,
										}))
									}
									disabled={readonly}
									style={{
										width: "200px",
										border: "1px solid #e5e7eb",
										borderRadius: 4,
										padding: "8px",
									}}
								>
									<option value="task_management">Task Management</option>
									<option value="approval">Approval</option>
									<option value="notification">Notification</option>
									<option value="integration">Integration</option>
									<option value="scheduling">Scheduling</option>
									<option value="custom">Custom</option>
								</select>
							</div>

							<div>
								<label
									htmlFor="workflow-tags"
									style={{ display: "block", marginBottom: 5, fontWeight: "bold" }}
								>
									Tags (comma-separated)
								</label>
								<input
									id="workflow-tags"
									type="text"
									value={currentWorkflow.metadata.tags.join(", ")}
									onChange={(e) =>
										setCurrentWorkflow((prev) => ({
											...prev,
											metadata: {
												...prev.metadata,
												tags: e.target.value
													.split(",")
													.map((t) => t.trim())
													.filter((t) => t),
											},
										}))
									}
									disabled={readonly}
									style={{
										width: "100%",
										border: "1px solid #e5e7eb",
										borderRadius: 4,
										padding: "8px",
									}}
								/>
							</div>

							<div>
								<label style={{ display: "flex", alignItems: "center", gap: 10 }}>
									<input
										id="workflow-enabled"
										type="checkbox"
										checked={currentWorkflow.enabled}
										onChange={(e) =>
											setCurrentWorkflow((prev) => ({ ...prev, enabled: e.target.checked }))
										}
										disabled={readonly}
									/>
									<span style={{ fontWeight: "bold" }}>Enabled</span>
								</label>
							</div>
						</div>
					</div>
				)}

				{activeTab === "variables" && (
					<div style={{ padding: "20px", background: "white", height: "100%" }}>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								marginBottom: 20,
							}}
						>
							<h3>Workflow Variables</h3>
							{!readonly && (
								<button
									type="button"
									onClick={addVariable}
									style={{
										padding: "8px 16px",
										border: "1px solid #e5e7eb",
										borderRadius: 6,
										background: "white",
										cursor: "pointer",
									}}
								>
									Add Variable
								</button>
							)}
						</div>

						{currentWorkflow.variables.length === 0 ? (
							<div style={{ textAlign: "center", color: "#6b7280", marginTop: 50 }}>
								No variables defined. Add variables to store data across your workflow.
							</div>
						) : (
							<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
								{currentWorkflow.variables.map((variable, index) => (
									<div
										key={`variable-${variable.name || index}`}
										style={{
											border: "1px solid #e5e7eb",
											borderRadius: 6,
											padding: 15,
											display: "flex",
											gap: 15,
											alignItems: "center",
										}}
									>
										<input
											type="text"
											placeholder="Variable name"
											value={variable.name}
											onChange={(e) => updateVariable(index, { name: e.target.value })}
											disabled={readonly}
											style={{
												flex: 1,
												border: "1px solid #e5e7eb",
												borderRadius: 4,
												padding: "6px",
											}}
										/>

										<select
											value={variable.type}
											onChange={(e) =>
												updateVariable(index, { type: e.target.value as WorkflowVariable["type"] })
											}
											disabled={readonly}
											style={{ border: "1px solid #e5e7eb", borderRadius: 4, padding: "6px" }}
										>
											<option value="string">String</option>
											<option value="number">Number</option>
											<option value="boolean">Boolean</option>
											<option value="object">Object</option>
											<option value="array">Array</option>
										</select>

										<input
											type="text"
											placeholder="Default value"
											value={String(variable.defaultValue || "")}
											onChange={(e) => updateVariable(index, { defaultValue: e.target.value })}
											disabled={readonly}
											style={{
												flex: 1,
												border: "1px solid #e5e7eb",
												borderRadius: 4,
												padding: "6px",
											}}
										/>

										{!readonly && (
											<button
												type="button"
												onClick={() => deleteVariable(index)}
												style={{
													padding: "6px 12px",
													border: "1px solid #ef4444",
													borderRadius: 4,
													background: "white",
													color: "#ef4444",
													cursor: "pointer",
												}}
											>
												Delete
											</button>
										)}
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
};
