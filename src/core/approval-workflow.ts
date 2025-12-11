import type { BaseEntity } from "./result.ts";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";
export type WorkflowStageType = "sequential" | "parallel" | "conditional";
export type ApprovalAction = "approve" | "reject" | "request_changes" | "cancel" | "escalate";

export interface ApprovalWorkflow extends BaseEntity {
	id: string;
	name: string;
	description: string;
	isActive: boolean;
	stages: WorkflowStage[];
	rules: WorkflowRule[];
	createdBy: string;
}

export interface WorkflowStage {
	id: string;
	name: string;
	description: string;
	type: WorkflowStageType;
	approvers: ApproverConfig[];
	conditions: StageCondition[];
	isRequired: boolean;
	timeoutDays?: number;
	escalationRules?: EscalationRule[];
}

export interface ApproverConfig {
	id: string;
	type: "user" | "role" | "group";
	value: string; // userId, roleId, or groupId
	isRequired: boolean;
	canDelegate: boolean;
	order?: number; // For sequential approval
}

export interface StageCondition {
	field: string;
	operator: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "in" | "not_in";
	value: string | number | boolean | string[];
}

export interface EscalationRule {
	afterHours: number;
	action: "escalate_to_manager" | "notify_admin" | "auto_approve" | "auto_reject";
	target?: string; // userId or roleId for escalation
}

export interface WorkflowRule {
	id: string;
	name: string;
	trigger: RuleTrigger;
	conditions: RuleCondition[];
	actions: RuleAction[];
	isActive: boolean;
}

export interface RuleTrigger {
	type: "task_created" | "task_status_changed" | "task_priority_changed" | "manual";
	parameters?: Record<string, string | number | boolean>;
}

export interface RuleCondition {
	field: string;
	operator: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "in";
	value: string | number | boolean | string[];
}

export interface RuleAction {
	type: "start_approval" | "assign_approvers" | "set_priority" | "notify_user";
	parameters: Record<string, string | number | boolean>;
}

export interface TaskApproval extends BaseEntity {
	id: string;
	taskId: string;
	workflowId: string;
	workflowName: string;
	currentStage: number;
	status: ApprovalStatus;
	requestedBy: string;
	requestedAt: Date;
	completedAt?: Date;
	completedBy?: string;
	reason?: string;
	stages: StageApproval[];
	auditTrail: ApprovalAuditEntry[];
	metadata: Record<string, string | number | boolean>;
}

export interface StageApproval {
	id: string;
	stageId: string;
	stageName: string;
	status: ApprovalStatus;
	approvers: ApproverDecision[];
	startedAt: Date;
	completedAt?: Date;
	timeoutAt?: Date;
	isRequired: boolean;
}

export interface ApproverDecision {
	id: string;
	approverId: string;
	approverType: "user" | "role" | "group";
	decision?: ApprovalAction;
	comment?: string;
	decidedAt?: Date;
	delegatedTo?: string;
	isRequired: boolean;
	canDelegate: boolean;
}

export interface ApprovalAuditEntry {
	id: string;
	timestamp: Date;
	action: string;
	userId: string;
	userType: "requester" | "approver" | "system";
	details: Record<string, string | number | boolean>;
}

export interface CreateApprovalWorkflowInput {
	name: string;
	description: string;
	stages: Omit<WorkflowStage, "id">[];
	rules?: Omit<WorkflowRule, "id">[];
}

export interface UpdateApprovalWorkflowInput {
	id: string;
	name?: string;
	description?: string;
	isActive?: boolean;
	stages?: Omit<WorkflowStage, "id">[];
	rules?: Omit<WorkflowRule, "id">[];
}

export interface StartTaskApprovalInput {
	taskId: string;
	workflowId?: string; // If not provided, will use auto-matching
	requestedBy: string;
	reason?: string;
	metadata?: Record<string, string | number | boolean>;
}

export interface ProcessApprovalInput {
	approvalId: string;
	stageId: string;
	approverId: string;
	action: ApprovalAction;
	comment?: string;
	delegatedTo?: string;
}

export interface ApprovalTemplate {
	id: string;
	name: string;
	description: string;
	category: "development" | "deployment" | "access" | "financial" | "custom";
	workflow: Omit<ApprovalWorkflow, "id" | "createdAt" | "updatedAt">;
	variables: TemplateVariable[];
	createdBy: string;
	isPublic: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface TemplateVariable {
	name: string;
	type: "text" | "number" | "date" | "select" | "boolean";
	description: string;
	required: boolean;
	defaultValue?: string | number | boolean | Date;
	options?: string[];
}

export interface ApprovalNotification {
	id: string;
	type:
		| "approval_requested"
		| "approval_completed"
		| "approval_rejected"
		| "approval_timeout"
		| "approval_escalated";
	recipientId: string;
	approvalId: string;
	stageId?: string;
	message: string;
	data: Record<string, string | number | boolean>;
	sentAt: Date;
	readAt?: Date;
}

export interface ApprovalStats {
	totalApprovals: number;
	pendingApprovals: number;
	approvedToday: number;
	rejectedToday: number;
	averageApprovalTime: number;
	approvalsByWorkflow: Record<string, number>;
	approvalsByUser: Record<string, number>;
	timeoutRate: number;
	escalationRate: number;
}
