import { useCallback, useEffect, useState } from "react";
import type { ApprovalWorkflow } from "../../../src/core/approval-workflow.ts";

interface ApprovalWorkflowListProps {
	onSelectWorkflow?: (workflow: ApprovalWorkflow) => void;
	onCreateWorkflow?: () => void;
}

export function ApprovalWorkflowList({
	onSelectWorkflow,
	onCreateWorkflow,
}: ApprovalWorkflowListProps) {
	const [workflows, setWorkflows] = useState<ApprovalWorkflow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchWorkflows = useCallback(async () => {
		try {
			const response = await fetch("/api/approval/workflows", {
				headers: {
					Authorization: `Bearer ${localStorage.getItem("authToken")}`,
				},
			});

			if (!response.ok) {
				throw new Error("Failed to fetch workflows");
			}

			const data = await response.json();
			setWorkflows(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unknown error");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchWorkflows();
	}, [fetchWorkflows]);

	if (loading) {
		return (
			<div style={{ padding: "20px", textAlign: "center" }}>
				<div>Loading workflows...</div>
			</div>
		);
	}

	if (error) {
		return (
			<div style={{ padding: "20px", textAlign: "center", color: "#ef4444" }}>
				<div>Error: {error}</div>
				<button
					type="button"
					onClick={fetchWorkflows}
					style={{
						marginTop: "10px",
						padding: "8px 16px",
						background: "#3b82f6",
						color: "white",
						border: "none",
						borderRadius: "4px",
						cursor: "pointer",
					}}
				>
					Retry
				</button>
			</div>
		);
	}

	return (
		<div style={{ padding: "20px" }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "20px",
				}}
			>
				<h2 style={{ margin: 0, color: "#e2e8f0" }}>Approval Workflows</h2>
				{onCreateWorkflow && (
					<button
						type="button"
						onClick={onCreateWorkflow}
						style={{
							padding: "10px 20px",
							background: "#3b82f6",
							color: "white",
							border: "none",
							borderRadius: "6px",
							cursor: "pointer",
							fontSize: "14px",
							fontWeight: "500",
						}}
					>
						+ Create Workflow
					</button>
				)}
			</div>

			{workflows.length === 0 ? (
				<div style={{ textAlign: "center", padding: "40px", color: "#9ca3af" }}>
					<div>No approval workflows found</div>
					{onCreateWorkflow && (
						<button
							type="button"
							onClick={onCreateWorkflow}
							style={{
								marginTop: "10px",
								padding: "8px 16px",
								background: "#3b82f6",
								color: "white",
								border: "none",
								borderRadius: "4px",
								cursor: "pointer",
							}}
						>
							Create your first workflow
						</button>
					)}
				</div>
			) : (
				<div style={{ display: "grid", gap: "16px" }}>
					{workflows.map((workflow) => (
						<button
							type="button"
							key={workflow.id}
							style={{
								background: "#1f2937",
								border: "1px solid #374151",
								borderRadius: "8px",
								padding: "16px",
								cursor: onSelectWorkflow ? "pointer" : "default",
								textAlign: "left",
							}}
							onClick={() => onSelectWorkflow?.(workflow)}
						>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "flex-start",
								}}
							>
								<div style={{ flex: 1 }}>
									<h3 style={{ margin: "0 0 8px 0", color: "#e2e8f0" }}>{workflow.name}</h3>
									<p style={{ margin: "0 0 12px 0", color: "#9ca3af", fontSize: "14px" }}>
										{workflow.description}
									</p>
									<div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "#6b7280" }}>
										<span>{workflow.stages.length} stages</span>
										<span>{workflow.rules.length} rules</span>
										<span
											style={{
												color: workflow.isActive ? "#10b981" : "#ef4444",
											}}
										>
											{workflow.isActive ? "Active" : "Inactive"}
										</span>
									</div>
								</div>
							</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

interface ApprovalWorkflowFormProps {
	workflow?: ApprovalWorkflow;
	onSave: (workflow: CreateApprovalWorkflowInput) => void;
	onCancel: () => void;
}

interface CreateApprovalWorkflowInput {
	name: string;
	description: string;
	stages: Array<{
		name: string;
		description: string;
		type: "sequential" | "parallel" | "conditional";
		approvers: Array<{
			type: "user" | "role" | "group";
			value: string;
			isRequired: boolean;
			canDelegate: boolean;
		}>;
		isRequired: boolean;
		timeoutDays?: number;
	}>;
	rules?: Array<{
		name: string;
		trigger: {
			type: "task_created" | "task_status_changed" | "task_priority_changed" | "manual";
		};
		conditions: Array<{
			field: string;
			operator: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "in";
			value: unknown;
		}>;
		actions: Array<{
			type: "start_approval" | "assign_approvers" | "set_priority" | "notify_user";
			parameters: Record<string, unknown>;
		}>;
		isActive: boolean;
	}>;
}

export function ApprovalWorkflowForm({ workflow, onSave, onCancel }: ApprovalWorkflowFormProps) {
	const [formData, setFormData] = useState<CreateApprovalWorkflowInput>({
		name: workflow?.name || "",
		description: workflow?.description || "",
		stages: workflow?.stages.map((stage) => ({
			name: stage.name,
			description: stage.description,
			type: stage.type,
			approvers: stage.approvers.map((approver) => ({
				type: approver.type,
				value: approver.value,
				isRequired: approver.isRequired,
				canDelegate: approver.canDelegate,
			})),
			isRequired: stage.isRequired,
			timeoutDays: stage.timeoutDays,
		})) || [
			{
				name: "Review",
				description: "Initial review stage",
				type: "sequential" as const,
				approvers: [
					{
						type: "role" as const,
						value: "manager",
						isRequired: true,
						canDelegate: true,
					},
				],
				isRequired: true,
			},
		],
		rules:
			workflow?.rules.map((rule) => ({
				name: rule.name,
				trigger: rule.trigger,
				conditions: rule.conditions,
				actions: rule.actions,
				isActive: rule.isActive,
			})) || [],
	});

	const [errors, setErrors] = useState<Record<string, string>>({});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		const newErrors: Record<string, string> = {};

		if (!formData.name.trim()) {
			newErrors.name = "Workflow name is required";
		}

		if (!formData.description.trim()) {
			newErrors.description = "Workflow description is required";
		}

		if (formData.stages.length === 0) {
			newErrors.stages = "At least one stage is required";
		}

		formData.stages.forEach((stage, index) => {
			if (!stage.name.trim()) {
				newErrors[`stage_${index}_name`] = "Stage name is required";
			}
			if (stage.approvers.length === 0) {
				newErrors[`stage_${index}_approvers`] = "At least one approver is required";
			}
		});

		if (Object.keys(newErrors).length > 0) {
			setErrors(newErrors);
			return;
		}

		setErrors({});
		onSave(formData);
	};

	const addStage = () => {
		setFormData({
			...formData,
			stages: [
				...formData.stages,
				{
					name: "",
					description: "",
					type: "sequential",
					approvers: [
						{
							type: "role",
							value: "manager",
							isRequired: true,
							canDelegate: true,
						},
					],
					isRequired: true,
				},
			],
		});
	};

	const removeStage = (index: number) => {
		setFormData({
			...formData,
			stages: formData.stages.filter((_, i) => i !== index),
		});
	};

	const updateStage = (index: number, updates: Partial<(typeof formData.stages)[0]>) => {
		setFormData({
			...formData,
			stages: formData.stages.map((stage, i) => (i === index ? { ...stage, ...updates } : stage)),
		});
	};

	const addApprover = (stageIndex: number) => {
		const updatedStages = [...formData.stages];
		updatedStages[stageIndex] = {
			...updatedStages[stageIndex],
			approvers: [
				...updatedStages[stageIndex].approvers,
				{
					type: "role",
					value: "manager",
					isRequired: true,
					canDelegate: true,
				},
			],
		};
		setFormData({ ...formData, stages: updatedStages });
	};

	const removeApprover = (stageIndex: number, approverIndex: number) => {
		const updatedStages = [...formData.stages];
		updatedStages[stageIndex] = {
			...updatedStages[stageIndex],
			approvers: updatedStages[stageIndex].approvers.filter((_, i) => i !== approverIndex),
		};
		setFormData({ ...formData, stages: updatedStages });
	};

	const updateApprover = (
		stageIndex: number,
		approverIndex: number,
		updates: Partial<(typeof formData.stages)[0]["approvers"][0]>,
	) => {
		const updatedStages = [...formData.stages];
		updatedStages[stageIndex] = {
			...updatedStages[stageIndex],
			approvers: updatedStages[stageIndex].approvers.map((approver, i) =>
				i === approverIndex ? { ...approver, ...updates } : approver,
			),
		};
		setFormData({ ...formData, stages: updatedStages });
	};

	return (
		<form onSubmit={handleSubmit} style={{ padding: "20px" }}>
			<h2 style={{ margin: "0 0 20px 0", color: "#e2e8f0" }}>
				{workflow ? "Edit Workflow" : "Create Workflow"}
			</h2>

			<div style={{ marginBottom: "20px" }}>
				<label
					htmlFor="workflow-name"
					style={{ display: "block", marginBottom: "8px", color: "#e2e8f0", fontWeight: "500" }}
				>
					Workflow Name *
				</label>
				<input
					id="workflow-name"
					type="text"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: e.target.value })}
					style={{
						width: "100%",
						padding: "10px",
						background: "#1f2937",
						border: `1px solid ${errors.name ? "#ef4444" : "#374151"}`,
						borderRadius: "6px",
						color: "#e2e8f0",
						fontSize: "14px",
					}}
					placeholder="Enter workflow name"
				/>
				{errors.name && (
					<div style={{ color: "#ef4444", fontSize: "12px", marginTop: "4px" }}>{errors.name}</div>
				)}
			</div>

			<div style={{ marginBottom: "20px" }}>
				<label
					htmlFor="workflow-description"
					style={{ display: "block", marginBottom: "8px", color: "#e2e8f0", fontWeight: "500" }}
				>
					Description *
				</label>
				<textarea
					id="workflow-description"
					value={formData.description}
					onChange={(e) => setFormData({ ...formData, description: e.target.value })}
					style={{
						width: "100%",
						padding: "10px",
						background: "#1f2937",
						border: `1px solid ${errors.description ? "#ef4444" : "#374151"}`,
						borderRadius: "6px",
						color: "#e2e8f0",
						fontSize: "14px",
						minHeight: "80px",
						resize: "vertical",
					}}
					placeholder="Describe the workflow purpose and when it should be used"
				/>
				{errors.description && (
					<div style={{ color: "#ef4444", fontSize: "12px", marginTop: "4px" }}>
						{errors.description}
					</div>
				)}
			</div>

			<div style={{ marginBottom: "20px" }}>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginBottom: "16px",
					}}
				>
					<h3 style={{ margin: 0, color: "#e2e8f0" }}>Approval Stages</h3>
					<button
						type="button"
						onClick={addStage}
						style={{
							padding: "8px 16px",
							background: "#3b82f6",
							color: "white",
							border: "none",
							borderRadius: "4px",
							cursor: "pointer",
							fontSize: "14px",
						}}
					>
						+ Add Stage
					</button>
				</div>

				{errors.stages && (
					<div style={{ color: "#ef4444", fontSize: "12px", marginBottom: "8px" }}>
						{errors.stages}
					</div>
				)}

				{formData.stages.map((stage, stageIndex) => {
					const stageKey = `${stage.name || "stage"}-${stage.type}-${stageIndex}`;
					const stageNameId = `stage-name-${stageIndex}`;
					const stageTypeId = `stage-type-${stageIndex}`;
					const stageDescId = `stage-desc-${stageIndex}`;
					const stageTimeoutId = `stage-timeout-${stageIndex}`;
					return (
						<div
							key={stageKey}
							style={{
								background: "#111827",
								border: "1px solid #374151",
								borderRadius: "8px",
								padding: "16px",
								marginBottom: "16px",
							}}
						>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									marginBottom: "12px",
								}}
							>
								<h4 style={{ margin: 0, color: "#e2e8f0" }}>Stage {stageIndex + 1}</h4>
								{formData.stages.length > 1 && (
									<button
										type="button"
										onClick={() => removeStage(stageIndex)}
										style={{
											padding: "4px 8px",
											background: "#ef4444",
											color: "white",
											border: "none",
											borderRadius: "4px",
											cursor: "pointer",
											fontSize: "12px",
										}}
									>
										Remove
									</button>
								)}
							</div>

							<div
								style={{
									display: "grid",
									gridTemplateColumns: "1fr 1fr",
									gap: "12px",
									marginBottom: "12px",
								}}
							>
								<div>
									<label
										htmlFor={stageNameId}
										style={{
											display: "block",
											marginBottom: "4px",
											color: "#9ca3af",
											fontSize: "12px",
										}}
									>
										Stage Name *
									</label>
									<input
										id={stageNameId}
										type="text"
										value={stage.name}
										onChange={(e) => updateStage(stageIndex, { name: e.target.value })}
										style={{
											width: "100%",
											padding: "8px",
											background: "#1f2937",
											border: `1px solid ${errors[`stage_${stageIndex}_name`] ? "#ef4444" : "#374151"}`,
											borderRadius: "4px",
											color: "#e2e8f0",
											fontSize: "14px",
										}}
										placeholder="e.g., Manager Review"
									/>
									{errors[`stage_${stageIndex}_name`] && (
										<div style={{ color: "#ef4444", fontSize: "10px", marginTop: "2px" }}>
											{errors[`stage_${stageIndex}_name`]}
										</div>
									)}
								</div>

								<div>
									<label
										htmlFor={stageTypeId}
										style={{
											display: "block",
											marginBottom: "4px",
											color: "#9ca3af",
											fontSize: "12px",
										}}
									>
										Type
									</label>
									<select
										id={stageTypeId}
										value={stage.type}
										onChange={(e) =>
											updateStage(stageIndex, {
												type: e.target.value as "sequential" | "parallel" | "conditional",
											})
										}
										style={{
											width: "100%",
											padding: "8px",
											background: "#1f2937",
											border: "1px solid #374151",
											borderRadius: "4px",
											color: "#e2e8f0",
											fontSize: "14px",
										}}
									>
										<option value="sequential">Sequential</option>
										<option value="parallel">Parallel</option>
										<option value="conditional">Conditional</option>
									</select>
								</div>
							</div>

							<div style={{ marginBottom: "12px" }}>
								<label
									htmlFor={stageDescId}
									style={{
										display: "block",
										marginBottom: "4px",
										color: "#9ca3af",
										fontSize: "12px",
									}}
								>
									Description
								</label>
								<input
									id={stageDescId}
									type="text"
									value={stage.description}
									onChange={(e) => updateStage(stageIndex, { description: e.target.value })}
									style={{
										width: "100%",
										padding: "8px",
										background: "#1f2937",
										border: "1px solid #374151",
										borderRadius: "4px",
										color: "#e2e8f0",
										fontSize: "14px",
									}}
									placeholder="Describe this approval stage"
								/>
							</div>

							<div
								style={{
									display: "grid",
									gridTemplateColumns: "1fr 1fr",
									gap: "12px",
									marginBottom: "12px",
								}}
							>
								<div>
									<label
										htmlFor={stageTimeoutId}
										style={{
											display: "block",
											marginBottom: "4px",
											color: "#9ca3af",
											fontSize: "12px",
										}}
									>
										Timeout (days)
									</label>
									<input
										id={stageTimeoutId}
										type="number"
										value={stage.timeoutDays || ""}
										onChange={(e) =>
											updateStage(stageIndex, {
												timeoutDays: parseInt(e.target.value, 10) || undefined,
											})
										}
										style={{
											width: "100%",
											padding: "8px",
											background: "#1f2937",
											border: "1px solid #374151",
											borderRadius: "4px",
											color: "#e2e8f0",
											fontSize: "14px",
										}}
										placeholder="Optional timeout in days"
									/>
								</div>

								<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
									<input
										id={`stage-required-${stageIndex}`}
										type="checkbox"
										checked={stage.isRequired}
										onChange={(e) => updateStage(stageIndex, { isRequired: e.target.checked })}
										style={{ cursor: "pointer" }}
									/>
									<label
										htmlFor={`stage-required-${stageIndex}`}
										style={{ color: "#9ca3af", fontSize: "12px", cursor: "pointer" }}
									>
										Required stage
									</label>
								</div>
							</div>

							<div>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										marginBottom: "8px",
									}}
								>
									<span style={{ color: "#9ca3af", fontSize: "12px", fontWeight: "500" }}>
										Approvers
									</span>
									<button
										type="button"
										onClick={() => addApprover(stageIndex)}
										style={{
											padding: "4px 8px",
											background: "#3b82f6",
											color: "white",
											border: "none",
											borderRadius: "4px",
											cursor: "pointer",
											fontSize: "12px",
										}}
									>
										+ Add Approver
									</button>
								</div>

								{errors[`stage_${stageIndex}_approvers`] && (
									<div style={{ color: "#ef4444", fontSize: "10px", marginBottom: "8px" }}>
										{errors[`stage_${stageIndex}_approvers`]}
									</div>
								)}

								{stage.approvers.map((approver, approverIndex) => {
									const approverKey = `${stageIndex}-${approver.type}-${approver.value}-${approverIndex}`;
									const approverTypeId = `approver-type-${stageIndex}-${approverIndex}`;
									const approverValueId = `approver-value-${stageIndex}-${approverIndex}`;
									const requiredId = `approver-required-${stageIndex}-${approverIndex}`;
									const delegateId = `approver-delegate-${stageIndex}-${approverIndex}`;
									return (
										<div
											key={approverKey}
											style={{
												background: "#1f2937",
												border: "1px solid #374151",
												borderRadius: "4px",
												padding: "12px",
												marginBottom: "8px",
											}}
										>
											<div
												style={{
													display: "grid",
													gridTemplateColumns: "1fr 1fr 1fr auto",
													gap: "8px",
													alignItems: "center",
												}}
											>
												<select
													id={approverTypeId}
													value={approver.type}
													onChange={(e) =>
														updateApprover(stageIndex, approverIndex, {
															type: e.target.value as "user" | "role" | "group",
														})
													}
													style={{
														padding: "6px",
														background: "#111827",
														border: "1px solid #374151",
														borderRadius: "4px",
														color: "#e2e8f0",
														fontSize: "12px",
													}}
												>
													<option value="user">User</option>
													<option value="role">Role</option>
													<option value="group">Group</option>
												</select>

												<input
													id={approverValueId}
													type="text"
													value={approver.value}
													onChange={(e) =>
														updateApprover(stageIndex, approverIndex, { value: e.target.value })
													}
													style={{
														padding: "6px",
														background: "#111827",
														border: "1px solid #374151",
														borderRadius: "4px",
														color: "#e2e8f0",
														fontSize: "12px",
													}}
													placeholder={
														approver.type === "role" ? "e.g., manager" : "e.g., john.doe"
													}
												/>

												<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
													<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
														<input
															id={requiredId}
															type="checkbox"
															checked={approver.isRequired}
															onChange={(e) =>
																updateApprover(stageIndex, approverIndex, {
																	isRequired: e.target.checked,
																})
															}
															style={{ cursor: "pointer" }}
														/>
														<label
															htmlFor={requiredId}
															style={{ color: "#9ca3af", fontSize: "10px", cursor: "pointer" }}
														>
															Required
														</label>
													</div>

													<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
														<input
															id={delegateId}
															type="checkbox"
															checked={approver.canDelegate}
															onChange={(e) =>
																updateApprover(stageIndex, approverIndex, {
																	canDelegate: e.target.checked,
																})
															}
															style={{ cursor: "pointer" }}
														/>
														<label
															htmlFor={delegateId}
															style={{ color: "#9ca3af", fontSize: "10px", cursor: "pointer" }}
														>
															Can Delegate
														</label>
													</div>
												</div>

												{stage.approvers.length > 1 && (
													<button
														type="button"
														onClick={() => removeApprover(stageIndex, approverIndex)}
														style={{
															padding: "4px",
															background: "#ef4444",
															color: "white",
															border: "none",
															borderRadius: "4px",
															cursor: "pointer",
															fontSize: "10px",
														}}
													>
														×
													</button>
												)}
											</div>
										</div>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>

			<div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
				<button
					type="button"
					onClick={onCancel}
					style={{
						padding: "10px 20px",
						background: "#374151",
						color: "#e2e8f0",
						border: "none",
						borderRadius: "6px",
						cursor: "pointer",
						fontSize: "14px",
					}}
				>
					Cancel
				</button>
				<button
					type="submit"
					style={{
						padding: "10px 20px",
						background: "#3b82f6",
						color: "white",
						border: "none",
						borderRadius: "6px",
						cursor: "pointer",
						fontSize: "14px",
						fontWeight: "500",
					}}
				>
					{workflow ? "Update Workflow" : "Create Workflow"}
				</button>
			</div>
		</form>
	);
}
