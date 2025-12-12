import type {
	ApprovalAction,
	ApprovalAuditEntry,
	ApprovalStats,
	ApprovalStatus,
	ApprovalTemplate,
	ApprovalWorkflow,
	ApproverConfig,
	ApproverDecision,
	CreateApprovalWorkflowInput,
	ProcessApprovalInput,
	StageApproval,
	StartTaskApprovalInput,
	TaskApproval,
	UpdateApprovalWorkflowInput,
	WorkflowRule,
	WorkflowStage,
} from "../core/approval-workflow.ts";
import { type EventBus, globalEventBus } from "../core/event-bus.ts";
import type { Result } from "../core/result.ts";
import {
	ConflictError,
	NotFoundError,
	UnauthorizedError,
	ValidationError,
} from "../core/result.ts";

export interface IApprovalWorkflowRepository {
	create(workflow: ApprovalWorkflow): Promise<Result<ApprovalWorkflow>>;
	findById(id: string): Promise<Result<ApprovalWorkflow | null>>;
	findAll(): Promise<Result<ApprovalWorkflow[]>>;
	update(id: string, workflow: ApprovalWorkflow): Promise<Result<ApprovalWorkflow>>;
	delete(id: string): Promise<Result<void>>;
	findActive(): Promise<Result<ApprovalWorkflow[]>>;
	findByCreator(createdBy: string): Promise<Result<ApprovalWorkflow[]>>;
}

export interface ITaskApprovalRepository {
	create(approval: TaskApproval): Promise<Result<TaskApproval>>;
	findById(id: string): Promise<Result<TaskApproval | null>>;
	findByTaskId(taskId: string): Promise<Result<TaskApproval[]>>;
	findByApprover(approverId: string): Promise<Result<TaskApproval[]>>;
	findPending(): Promise<Result<TaskApproval[]>>;
	update(id: string, approval: TaskApproval): Promise<Result<TaskApproval>>;
	delete(id: string): Promise<Result<void>>;
	findByStatus(status: ApprovalStatus): Promise<Result<TaskApproval[]>>;
	findAll(): Promise<Result<TaskApproval[]>>;
}

export interface IApprovalTemplateRepository {
	create(template: ApprovalTemplate): Promise<Result<ApprovalTemplate>>;
	findById(id: string): Promise<Result<ApprovalTemplate | null>>;
	findAll(): Promise<Result<ApprovalTemplate[]>>;
	findPublic(): Promise<Result<ApprovalTemplate[]>>;
	findByCategory(category: string): Promise<Result<ApprovalTemplate[]>>;
	update(id: string, template: ApprovalTemplate): Promise<Result<ApprovalTemplate>>;
	delete(id: string): Promise<Result<void>>;
}

export interface IApprovalWorkflowService {
	workflow: {
		create(
			input: CreateApprovalWorkflowInput,
			createdBy: string,
		): Promise<Result<ApprovalWorkflow>>;
		get(id: string): Promise<Result<ApprovalWorkflow>>;
		getAll(): Promise<Result<ApprovalWorkflow[]>>;
		update(
			id: string,
			input: UpdateApprovalWorkflowInput,
			updatedBy: string,
		): Promise<Result<ApprovalWorkflow>>;
		delete(id: string, deletedBy: string): Promise<Result<void>>;
		getActive(): Promise<Result<ApprovalWorkflow[]>>;
		getByCreator(createdBy: string): Promise<Result<ApprovalWorkflow[]>>;
	};

	approval: {
		start(input: StartTaskApprovalInput): Promise<Result<TaskApproval>>;
		get(id: string): Promise<Result<TaskApproval>>;
		getByTask(taskId: string): Promise<Result<TaskApproval[]>>;
		getByApprover(approverId: string): Promise<Result<TaskApproval[]>>;
		getPending(): Promise<Result<TaskApproval[]>>;
		process(input: ProcessApprovalInput): Promise<Result<TaskApproval>>;
		cancel(approvalId: string, userId: string, reason?: string): Promise<Result<TaskApproval>>;
		escalate(
			approvalId: string,
			stageId: string,
			userId: string,
			reason?: string,
		): Promise<Result<TaskApproval>>;
		delegate(
			approvalId: string,
			stageId: string,
			fromUserId: string,
			toUserId: string,
		): Promise<Result<TaskApproval>>;
	};

	template: {
		create(
			input: Omit<ApprovalTemplate, "id" | "createdAt" | "updatedAt">,
		): Promise<Result<ApprovalTemplate>>;
		get(id: string): Promise<Result<ApprovalTemplate>>;
		getAll(): Promise<Result<ApprovalTemplate[]>>;
		getPublic(): Promise<Result<ApprovalTemplate[]>>;
		getByCategory(category: string): Promise<Result<ApprovalTemplate[]>>;
		update(id: string, input: Partial<ApprovalTemplate>): Promise<Result<ApprovalTemplate>>;
		delete(id: string): Promise<Result<void>>;
	};

	stats: {
		getStats(): Promise<Result<ApprovalStats>>;
		getUserStats(userId: string): Promise<Result<ApprovalStats>>;
		getWorkflowStats(workflowId: string): Promise<Result<ApprovalStats>>;
	};
}

export class ApprovalWorkflowService implements IApprovalWorkflowService {
	private readonly workflowRepo: IApprovalWorkflowRepository;
	private readonly approvalRepo: ITaskApprovalRepository;
	private readonly templateRepo: IApprovalTemplateRepository;
	private readonly eventBus: EventBus;

	constructor(
		workflowRepo: IApprovalWorkflowRepository,
		approvalRepo: ITaskApprovalRepository,
		templateRepo: IApprovalTemplateRepository,
		eventBus: EventBus = globalEventBus,
	) {
		this.workflowRepo = workflowRepo;
		this.approvalRepo = approvalRepo;
		this.templateRepo = templateRepo;
		this.eventBus = eventBus;
	}

	workflow = {
		create: async (
			input: CreateApprovalWorkflowInput,
			createdBy: string,
		): Promise<Result<ApprovalWorkflow>> => {
			const validation = this.validateWorkflowInput(input);
			if (!validation.success) {
				return {
					success: false,
					error: validation.error,
				};
			}

			const workflow: ApprovalWorkflow = {
				id: `workflow-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
				name: input.name.trim(),
				description: input.description.trim(),
				isActive: true,
				stages: input.stages.map((stage, index) => ({
					...stage,
					id: `stage-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 11)}`,
				})),
				rules: (input.rules || []).map((rule, index) => ({
					...rule,
					id: `rule-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 11)}`,
				})),
				createdBy,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const result = await this.workflowRepo.create(workflow);
			if (result.success) {
				await this.eventBus.publish({
					id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
					type: "approval_workflow_created",
					timestamp: new Date(),
					data: { workflow, createdBy },
				});
			}

			return result;
		},

		get: async (id: string): Promise<Result<ApprovalWorkflow>> => {
			const result = await this.workflowRepo.findById(id);
			if (!result.success) {
				return result;
			}

			if (!result.data) {
				return {
					success: false,
					error: new NotFoundError("ApprovalWorkflow", id),
				};
			}

			return { success: true, data: result.data };
		},

		getAll: async (): Promise<Result<ApprovalWorkflow[]>> => {
			return await this.workflowRepo.findAll();
		},

		update: async (
			id: string,
			input: UpdateApprovalWorkflowInput,
			updatedBy: string,
		): Promise<Result<ApprovalWorkflow>> => {
			const existingResult = await this.workflow.get(id);
			if (!existingResult.success) {
				return existingResult;
			}

			const existing = existingResult.data;
			const { stages: inputStages, rules: inputRules, ...rest } = input;

			const updated: ApprovalWorkflow = {
				...existing,
				...rest,
				updatedAt: new Date(),
			};

			if (inputStages) {
				updated.stages = inputStages.map((stage: WorkflowStage, index: number) => ({
					...stage,
					id:
						stage.id ||
						`stage-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 11)}`,
				}));
			}

			if (inputRules) {
				updated.rules = inputRules.map((rule: WorkflowRule, index: number) => ({
					...rule,
					id:
						rule.id || `rule-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 11)}`,
				}));
			}

			const result = await this.workflowRepo.update(id, updated);
			if (result.success) {
				await this.eventBus.publish({
					id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
					type: "approval_workflow_updated",
					timestamp: new Date(),
					data: { workflow: result.data, updatedBy },
				});
			}

			return result;
		},

		delete: async (id: string, deletedBy: string): Promise<Result<void>> => {
			const existingResult = await this.workflow.get(id);
			if (!existingResult.success) {
				return { success: false, error: existingResult.error };
			}

			const result = await this.workflowRepo.delete(id);
			if (result.success) {
				await this.eventBus.publish({
					id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
					type: "approval_workflow_deleted",
					timestamp: new Date(),
					data: { workflowId: id, deletedBy },
				});
			}

			return result;
		},

		getActive: async (): Promise<Result<ApprovalWorkflow[]>> => {
			return await this.workflowRepo.findActive();
		},

		getByCreator: async (createdBy: string): Promise<Result<ApprovalWorkflow[]>> => {
			return await this.workflowRepo.findByCreator(createdBy);
		},
	};

	approval = {
		start: async (input: StartTaskApprovalInput): Promise<Result<TaskApproval>> => {
			let workflow: ApprovalWorkflow;

			if (input.workflowId) {
				const workflowResult = await this.workflow.get(input.workflowId);
				if (!workflowResult.success || !workflowResult.data) {
					return { success: false, error: workflowResult.error };
				}
				workflow = workflowResult.data;
			} else {
				const activeWorkflowsResult = await this.workflow.getActive();
				if (!activeWorkflowsResult.success || !activeWorkflowsResult.data) {
					return { success: false, error: activeWorkflowsResult.error };
				}

				const matchedWorkflow = this.findMatchingWorkflow(activeWorkflowsResult.data, input.taskId);
				if (!matchedWorkflow) {
					return {
						success: false,
						error: new ValidationError("No matching approval workflow found for this task"),
					};
				}
				workflow = matchedWorkflow;
			}

			const existingApprovalResult = await this.approvalRepo.findByTaskId(input.taskId);
			if (existingApprovalResult.success && existingApprovalResult.data) {
				const pendingApprovals = existingApprovalResult.data.filter(
					(a: TaskApproval) => a.status === "pending",
				);
				if (pendingApprovals.length > 0) {
					return {
						success: false,
						error: new ConflictError("Task already has a pending approval"),
					};
				}
			}

			const approval: TaskApproval = {
				id: `approval-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
				taskId: input.taskId,
				workflowId: workflow.id,
				workflowName: workflow.name,
				currentStage: 0,
				status: "pending",
				requestedBy: input.requestedBy,
				requestedAt: new Date(),
				stages: this.createStageApprovals(workflow.stages),
				auditTrail: [
					{
						id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
						timestamp: new Date(),
						action: "approval_started",
						userId: input.requestedBy,
						userType: "requester",
						details: { workflowId: workflow.id, reason: input.reason },
					},
				],
				metadata: input.metadata || {},
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const result = await this.approvalRepo.create(approval);
			if (result.success) {
				await this.eventBus.publish({
					id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
					type: "task_approval_started",
					timestamp: new Date(),
					data: { approval: result.data, workflow },
				});
			}

			return result;
		},

		get: async (id: string): Promise<Result<TaskApproval>> => {
			const result = await this.approvalRepo.findById(id);
			if (!result.success) {
				return result;
			}

			if (!result.data) {
				return {
					success: false,
					error: new NotFoundError("TaskApproval", id),
				};
			}

			return { success: true, data: result.data };
		},

		getByTask: async (taskId: string): Promise<Result<TaskApproval[]>> => {
			return await this.approvalRepo.findByTaskId(taskId);
		},

		getByApprover: async (approverId: string): Promise<Result<TaskApproval[]>> => {
			return await this.approvalRepo.findByApprover(approverId);
		},

		getPending: async (): Promise<Result<TaskApproval[]>> => {
			return await this.approvalRepo.findPending();
		},

		process: async (input: ProcessApprovalInput): Promise<Result<TaskApproval>> => {
			const approvalResult = await this.approval.get(input.approvalId);
			if (!approvalResult.success) {
				return approvalResult;
			}

			const approval = approvalResult.data;

			if (approval.status !== "pending") {
				return {
					success: false,
					error: new ValidationError("Approval is not in pending status"),
				};
			}

			const stage = approval.stages.find((s: StageApproval) => s.stageId === input.stageId);
			if (!stage) {
				return {
					success: false,
					error: new NotFoundError("Stage", input.stageId),
				};
			}

			const approverDecision = stage.approvers.find(
				(a: ApproverDecision) => a.approverId === input.approverId,
			);
			if (!approverDecision) {
				return {
					success: false,
					error: new UnauthorizedError("process", "approval"),
				};
			}

			if (approverDecision.decision) {
				return {
					success: false,
					error: new ConflictError("Approver has already made a decision"),
				};
			}

			approverDecision.decision = input.action;
			approverDecision.comment = input.comment;
			approverDecision.decidedAt = new Date();
			if (input.delegatedTo) {
				approverDecision.delegatedTo = input.delegatedTo;
			}

			approval.auditTrail.push({
				id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
				timestamp: new Date(),
				action: `approval_${input.action}`,
				userId: input.approverId,
				userType: "approver",
				details: { stageId: input.stageId, action: input.action, comment: input.comment },
			});

			const updatedApproval = await this.evaluateStageCompletion(approval, stage);
			const result = await this.approvalRepo.update(input.approvalId, updatedApproval);

			if (result.success) {
				await this.eventBus.publish({
					id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
					type: "task_approval_processed",
					timestamp: new Date(),
					data: {
						approval: result.data,
						stageId: input.stageId,
						approverId: input.approverId,
						action: input.action,
					},
				});
			}

			return result;
		},

		cancel: async (
			approvalId: string,
			userId: string,
			reason?: string,
		): Promise<Result<TaskApproval>> => {
			const approvalResult = await this.approval.get(approvalId);
			if (!approvalResult.success) {
				return approvalResult;
			}

			const approval = approvalResult.data;

			if (approval.status !== "pending") {
				return {
					success: false,
					error: new ValidationError("Cannot cancel completed approval"),
				};
			}

			if (approval.requestedBy !== userId) {
				return {
					success: false,
					error: new UnauthorizedError("cancel", "approval"),
				};
			}

			approval.status = "cancelled";
			approval.completedAt = new Date();
			approval.completedBy = userId;
			if (reason) {
				approval.reason = reason;
			}

			approval.auditTrail.push({
				id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
				timestamp: new Date(),
				action: "approval_cancelled",
				userId: userId,
				userType: "requester",
				details: { reason },
			});

			const result = await this.approvalRepo.update(approvalId, approval);

			if (result.success) {
				await this.eventBus.publish({
					id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
					type: "task_approval_cancelled",
					timestamp: new Date(),
					data: { approval: result.data, cancelledBy: userId, reason },
				});
			}

			return result;
		},

		escalate: async (
			approvalId: string,
			stageId: string,
			userId: string,
			reason?: string,
		): Promise<Result<TaskApproval>> => {
			const approvalResult = await this.approval.get(approvalId);
			if (!approvalResult.success) {
				return approvalResult;
			}

			const approval = approvalResult.data;
			const stage = approval.stages.find((s: StageApproval) => s.stageId === stageId);

			if (!stage) {
				return {
					success: false,
					error: new NotFoundError("Stage", stageId),
				};
			}

			approval.auditTrail.push({
				id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
				timestamp: new Date(),
				action: "approval_escalated",
				userId: userId,
				userType: "approver",
				details: { stageId, reason },
			});

			const result = await this.approvalRepo.update(approvalId, approval);

			if (result.success) {
				await this.eventBus.publish({
					id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
					type: "task_approval_escalated",
					timestamp: new Date(),
					data: { approval: result.data, stageId, escalatedBy: userId, reason },
				});
			}

			return result;
		},

		delegate: async (
			approvalId: string,
			stageId: string,
			fromUserId: string,
			toUserId: string,
		): Promise<Result<TaskApproval>> => {
			const approvalResult = await this.approval.get(approvalId);
			if (!approvalResult.success) {
				return approvalResult;
			}

			const approval = approvalResult.data;
			const stage = approval.stages.find((s: StageApproval) => s.stageId === stageId);

			if (!stage) {
				return {
					success: false,
					error: new NotFoundError("Stage", stageId),
				};
			}

			const approverDecision = stage.approvers.find(
				(a: ApproverDecision) => a.approverId === fromUserId,
			);
			if (!approverDecision) {
				return {
					success: false,
					error: new NotFoundError("Approver", fromUserId),
				};
			}

			if (!approverDecision.canDelegate) {
				return {
					success: false,
					error: new ValidationError("Approver cannot delegate this approval"),
				};
			}

			approverDecision.delegatedTo = toUserId;

			approval.auditTrail.push({
				id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
				timestamp: new Date(),
				action: "approval_delegated",
				userId: fromUserId,
				userType: "approver",
				details: { stageId, delegatedTo: toUserId },
			});

			const result = await this.approvalRepo.update(approvalId, approval);

			if (result.success) {
				await this.eventBus.publish({
					id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
					type: "task_approval_delegated",
					timestamp: new Date(),
					data: { approval: result.data, stageId, delegatedBy: fromUserId, delegatedTo: toUserId },
				});
			}

			return result;
		},
	};

	template = {
		create: async (
			input: Omit<ApprovalTemplate, "id" | "createdAt" | "updatedAt">,
		): Promise<Result<ApprovalTemplate>> => {
			const template: ApprovalTemplate = {
				...input,
				id: `template-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			return await this.templateRepo.create(template);
		},

		get: async (id: string): Promise<Result<ApprovalTemplate>> => {
			const result = await this.templateRepo.findById(id);
			if (!result.success) {
				return result;
			}

			if (!result.data) {
				return {
					success: false,
					error: new NotFoundError("ApprovalTemplate", id),
				};
			}

			return { success: true, data: result.data };
		},

		getAll: async (): Promise<Result<ApprovalTemplate[]>> => {
			return await this.templateRepo.findAll();
		},

		getPublic: async (): Promise<Result<ApprovalTemplate[]>> => {
			return await this.templateRepo.findPublic();
		},

		getByCategory: async (category: string): Promise<Result<ApprovalTemplate[]>> => {
			return await this.templateRepo.findByCategory(category);
		},

		update: async (
			id: string,
			input: Partial<ApprovalTemplate>,
		): Promise<Result<ApprovalTemplate>> => {
			const existingResult = await this.template.get(id);
			if (!existingResult.success) {
				return existingResult;
			}

			const updated: ApprovalTemplate = {
				...existingResult.data,
				...input,
				updatedAt: new Date(),
			};

			return await this.templateRepo.update(id, updated);
		},

		delete: async (id: string): Promise<Result<void>> => {
			return await this.templateRepo.delete(id);
		},
	};

	stats = {
		getStats: async (): Promise<Result<ApprovalStats>> => {
			const allApprovalsResult = await this.approvalRepo.findAll();
			if (!allApprovalsResult.success || !allApprovalsResult.data) {
				return { success: false, error: allApprovalsResult.error };
			}

			const approvals = allApprovalsResult.data;
			const pendingApprovals = approvals.filter((a: TaskApproval) => a.status === "pending");
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const todayApprovals = approvals.filter(
				(a: TaskApproval) => a.completedAt && a.completedAt >= today,
			);
			const approvedToday = todayApprovals.filter((a: TaskApproval) => a.status === "approved");
			const rejectedToday = todayApprovals.filter((a: TaskApproval) => a.status === "rejected");

			const stats: ApprovalStats = {
				totalApprovals: approvals.length,
				pendingApprovals: pendingApprovals.length,
				approvedToday: approvedToday.length,
				rejectedToday: rejectedToday.length,
				averageApprovalTime: this.calculateAverageApprovalTime(approvals),
				approvalsByWorkflow: this.groupApprovalsByWorkflow(approvals),
				approvalsByUser: this.groupApprovalsByUser(approvals),
				timeoutRate: this.calculateTimeoutRate(approvals),
				escalationRate: this.calculateEscalationRate(approvals),
			};

			return { success: true, data: stats };
		},

		getUserStats: async (userId: string): Promise<Result<ApprovalStats>> => {
			const userApprovalsResult = await this.approvalRepo.findByApprover(userId);
			if (!userApprovalsResult.success || !userApprovalsResult.data) {
				return { success: false, error: userApprovalsResult.error };
			}

			const approvals = userApprovalsResult.data;
			const pendingApprovals = approvals.filter((a: TaskApproval) => a.status === "pending");
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const todayApprovals = approvals.filter(
				(a: TaskApproval) => a.completedAt && a.completedAt >= today,
			);
			const approvedToday = todayApprovals.filter((a: TaskApproval) => a.status === "approved");
			const rejectedToday = todayApprovals.filter((a: TaskApproval) => a.status === "rejected");

			const stats: ApprovalStats = {
				totalApprovals: approvals.length,
				pendingApprovals: pendingApprovals.length,
				approvedToday: approvedToday.length,
				rejectedToday: rejectedToday.length,
				averageApprovalTime: this.calculateAverageApprovalTime(approvals),
				approvalsByWorkflow: this.groupApprovalsByWorkflow(approvals),
				approvalsByUser: { [userId]: approvals.length },
				timeoutRate: this.calculateTimeoutRate(approvals),
				escalationRate: this.calculateEscalationRate(approvals),
			};

			return { success: true, data: stats };
		},

		getWorkflowStats: async (workflowId: string): Promise<Result<ApprovalStats>> => {
			const allApprovalsResult = await this.approvalRepo.findAll();
			if (!allApprovalsResult.success || !allApprovalsResult.data) {
				return { success: false, error: allApprovalsResult.error };
			}

			const workflowApprovals = allApprovalsResult.data.filter(
				(a: TaskApproval) => a.workflowId === workflowId,
			);
			const pendingApprovals = workflowApprovals.filter(
				(a: TaskApproval) => a.status === "pending",
			);
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const todayApprovals = workflowApprovals.filter(
				(a: TaskApproval) => a.completedAt && a.completedAt >= today,
			);
			const approvedToday = todayApprovals.filter((a: TaskApproval) => a.status === "approved");
			const rejectedToday = todayApprovals.filter((a: TaskApproval) => a.status === "rejected");

			const stats: ApprovalStats = {
				totalApprovals: workflowApprovals.length,
				pendingApprovals: pendingApprovals.length,
				approvedToday: approvedToday.length,
				rejectedToday: rejectedToday.length,
				averageApprovalTime: this.calculateAverageApprovalTime(workflowApprovals),
				approvalsByWorkflow: { [workflowId]: workflowApprovals.length },
				approvalsByUser: this.groupApprovalsByUser(workflowApprovals),
				timeoutRate: this.calculateTimeoutRate(workflowApprovals),
				escalationRate: this.calculateEscalationRate(workflowApprovals),
			};

			return { success: true, data: stats };
		},
	};

	private validateWorkflowInput(input: CreateApprovalWorkflowInput): Result<void> {
		if (!input.name || input.name.trim().length === 0) {
			return {
				success: false,
				error: new ValidationError("Workflow name is required", "name"),
			};
		}

		if (!input.description || input.description.trim().length === 0) {
			return {
				success: false,
				error: new ValidationError("Workflow description is required", "description"),
			};
		}

		if (!input.stages || input.stages.length === 0) {
			return {
				success: false,
				error: new ValidationError("At least one stage is required", "stages"),
			};
		}

		for (const stage of input.stages) {
			if (!stage.name || stage.name.trim().length === 0) {
				return {
					success: false,
					error: new ValidationError("Stage name is required", "stages.name"),
				};
			}

			if (!stage.approvers || stage.approvers.length === 0) {
				return {
					success: false,
					error: new ValidationError(
						"At least one approver is required for each stage",
						"stages.approvers",
					),
				};
			}
		}

		return { success: true, data: undefined };
	}

	private findMatchingWorkflow(
		workflows: ApprovalWorkflow[],
		_taskId: string,
	): ApprovalWorkflow | null {
		return workflows.find((w: ApprovalWorkflow) => w.isActive) || null;
	}

	private createStageApprovals(stages: WorkflowStage[]): StageApproval[] {
		return stages.map((stage: WorkflowStage, index: number) => {
			const stageApproval: StageApproval = {
				id: `stage-approval-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 11)}`,
				stageId: stage.id,
				stageName: stage.name,
				status: index === 0 ? "pending" : "pending",
				approvers: stage.approvers.map((approver: ApproverConfig, approverIndex: number) => ({
					id: `approver-${Date.now()}-${approverIndex}-${Math.random().toString(36).substring(2, 11)}`,
					approverId: approver.value,
					approverType: approver.type,
					isRequired: approver.isRequired,
					canDelegate: approver.canDelegate,
				})),
				startedAt: index === 0 ? new Date() : new Date(),
				isRequired: stage.isRequired,
			};

			if (stage.timeoutDays) {
				stageApproval.timeoutAt = new Date(Date.now() + stage.timeoutDays * 24 * 60 * 60 * 1000);
			}

			return stageApproval;
		});
	}

	private async evaluateStageCompletion(
		approval: TaskApproval,
		completedStage: StageApproval,
	): Promise<TaskApproval> {
		const stage = approval.stages.find((s: StageApproval) => s.stageId === completedStage.stageId);
		if (!stage) {
			return approval;
		}

		const requiredApprovers = stage.approvers.filter((a: ApproverDecision) => a.isRequired);
		const requiredDecisions = requiredApprovers.filter((a: ApproverDecision) => a.decision);
		const allRequiredDecided = requiredDecisions.length === requiredApprovers.length;

		if (allRequiredDecided) {
			const approvals = requiredDecisions.map((d: ApproverDecision) => d.decision);
			const hasRejection = approvals.some((a: ApprovalAction | undefined) => a === "reject");
			const hasRequestChanges = approvals.some(
				(a: ApprovalAction | undefined) => a === "request_changes",
			);

			if (hasRejection) {
				stage.status = "rejected";
				approval.status = "rejected";
				approval.completedAt = new Date();
				approval.currentStage = approval.stages.indexOf(stage);
			} else if (hasRequestChanges) {
				stage.status = "rejected";
				approval.status = "rejected";
				approval.completedAt = new Date();
				approval.currentStage = approval.stages.indexOf(stage);
			} else {
				stage.status = "approved";
				stage.completedAt = new Date();

				const stageIndex = approval.stages.indexOf(stage);
				if (stageIndex < approval.stages.length - 1) {
					approval.currentStage = stageIndex + 1;
					approval.stages[stageIndex + 1].status = "pending";
					approval.stages[stageIndex + 1].startedAt = new Date();
				} else {
					approval.status = "approved";
					approval.completedAt = new Date();
				}
			}
		}

		approval.updatedAt = new Date();
		return approval;
	}

	private calculateAverageApprovalTime(approvals: TaskApproval[]): number {
		const completedApprovals = approvals.filter(
			(a: TaskApproval) => a.completedAt && a.requestedAt,
		);
		if (completedApprovals.length === 0) return 0;

		const totalTime = completedApprovals.reduce((sum: number, approval: TaskApproval) => {
			return sum + (approval.completedAt?.getTime() || 0 - approval.requestedAt.getTime());
		}, 0);

		return totalTime / completedApprovals.length / (1000 * 60 * 60); // Convert to hours
	}

	private groupApprovalsByWorkflow(approvals: TaskApproval[]): Record<string, number> {
		return approvals.reduce(
			(groups: Record<string, number>, approval: TaskApproval) => {
				groups[approval.workflowId] = (groups[approval.workflowId] || 0) + 1;
				return groups;
			},
			{} as Record<string, number>,
		);
	}

	private groupApprovalsByUser(approvals: TaskApproval[]): Record<string, number> {
		return approvals.reduce(
			(groups: Record<string, number>, approval: TaskApproval) => {
				approval.stages.forEach((stage: StageApproval) => {
					stage.approvers.forEach((approver: ApproverDecision) => {
						if (approver.decision) {
							groups[approver.approverId] = (groups[approver.approverId] || 0) + 1;
						}
					});
				});
				return groups;
			},
			{} as Record<string, number>,
		);
	}

	private calculateTimeoutRate(approvals: TaskApproval[]): number {
		const completedApprovals = approvals.filter((a: TaskApproval) => a.completedAt);
		if (completedApprovals.length === 0) return 0;

		const timedOutApprovals = completedApprovals.filter((approval: TaskApproval) => {
			return approval.stages.some((stage: StageApproval) => {
				return stage.timeoutAt && stage.completedAt && stage.completedAt > stage.timeoutAt;
			});
		});

		return (timedOutApprovals.length / completedApprovals.length) * 100;
	}

	private calculateEscalationRate(approvals: TaskApproval[]): number {
		const totalApprovals = approvals.length;
		if (totalApprovals === 0) return 0;

		const escalatedApprovals = approvals.filter((approval: TaskApproval) => {
			return approval.auditTrail.some(
				(entry: ApprovalAuditEntry) => entry.action === "approval_escalated",
			);
		});

		return (escalatedApprovals.length / totalApprovals) * 100;
	}
}
