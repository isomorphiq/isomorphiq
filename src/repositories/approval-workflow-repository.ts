import type {
	ApprovalStatus,
	ApprovalTemplate,
	ApprovalWorkflow,
	TaskApproval,
} from "../core/approval-workflow.ts";
import type { Result } from "../core/result.ts";
import type {
	IApprovalTemplateRepository,
	IApprovalWorkflowRepository,
	ITaskApprovalRepository,
} from "../services/approval-workflow-service.ts";

export class InMemoryApprovalWorkflowRepository implements IApprovalWorkflowRepository {
	private workflows: Map<string, ApprovalWorkflow> = new Map();

	async create(workflow: ApprovalWorkflow): Promise<Result<ApprovalWorkflow>> {
		try {
			this.workflows.set(workflow.id, workflow);
			return { success: true, data: workflow };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findById(id: string): Promise<Result<ApprovalWorkflow | null>> {
		try {
			const workflow = this.workflows.get(id) || null;
			return { success: true, data: workflow };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findAll(): Promise<Result<ApprovalWorkflow[]>> {
		try {
			const workflows = Array.from(this.workflows.values());
			return { success: true, data: workflows };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async update(id: string, workflow: ApprovalWorkflow): Promise<Result<ApprovalWorkflow>> {
		try {
			if (!this.workflows.has(id)) {
				return {
					success: false,
					error: new Error(`Workflow with id ${id} not found`),
				};
			}
			this.workflows.set(id, workflow);
			return { success: true, data: workflow };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async delete(id: string): Promise<Result<void>> {
		try {
			if (!this.workflows.has(id)) {
				return {
					success: false,
					error: new Error(`Workflow with id ${id} not found`),
				};
			}
			this.workflows.delete(id);
			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findActive(): Promise<Result<ApprovalWorkflow[]>> {
		try {
			const activeWorkflows = Array.from(this.workflows.values()).filter((w) => w.isActive);
			return { success: true, data: activeWorkflows };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findByCreator(createdBy: string): Promise<Result<ApprovalWorkflow[]>> {
		try {
			const workflows = Array.from(this.workflows.values()).filter(
				(w) => w.createdBy === createdBy,
			);
			return { success: true, data: workflows };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}
}

export class InMemoryTaskApprovalRepository implements ITaskApprovalRepository {
	private approvals: Map<string, TaskApproval> = new Map();

	async create(approval: TaskApproval): Promise<Result<TaskApproval>> {
		try {
			this.approvals.set(approval.id, approval);
			return { success: true, data: approval };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findById(id: string): Promise<Result<TaskApproval | null>> {
		try {
			const approval = this.approvals.get(id) || null;
			return { success: true, data: approval };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findByTaskId(taskId: string): Promise<Result<TaskApproval[]>> {
		try {
			const approvals = Array.from(this.approvals.values()).filter((a) => a.taskId === taskId);
			return { success: true, data: approvals };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findByApprover(approverId: string): Promise<Result<TaskApproval[]>> {
		try {
			const approvals = Array.from(this.approvals.values()).filter((approval) =>
				approval.stages.some((stage) =>
					stage.approvers.some((approver) => approver.approverId === approverId),
				),
			);
			return { success: true, data: approvals };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findPending(): Promise<Result<TaskApproval[]>> {
		try {
			const pendingApprovals = Array.from(this.approvals.values()).filter(
				(a) => a.status === "pending",
			);
			return { success: true, data: pendingApprovals };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async update(id: string, approval: TaskApproval): Promise<Result<TaskApproval>> {
		try {
			if (!this.approvals.has(id)) {
				return {
					success: false,
					error: new Error(`Approval with id ${id} not found`),
				};
			}
			this.approvals.set(id, approval);
			return { success: true, data: approval };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async delete(id: string): Promise<Result<void>> {
		try {
			if (!this.approvals.has(id)) {
				return {
					success: false,
					error: new Error(`Approval with id ${id} not found`),
				};
			}
			this.approvals.delete(id);
			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findByStatus(status: ApprovalStatus): Promise<Result<TaskApproval[]>> {
		try {
			const approvals = Array.from(this.approvals.values()).filter((a) => a.status === status);
			return { success: true, data: approvals };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findAll(): Promise<Result<TaskApproval[]>> {
		try {
			const approvals = Array.from(this.approvals.values());
			return { success: true, data: approvals };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}
}

export class InMemoryApprovalTemplateRepository implements IApprovalTemplateRepository {
	private templates: Map<string, ApprovalTemplate> = new Map();

	async create(template: ApprovalTemplate): Promise<Result<ApprovalTemplate>> {
		try {
			this.templates.set(template.id, template);
			return { success: true, data: template };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findById(id: string): Promise<Result<ApprovalTemplate | null>> {
		try {
			const template = this.templates.get(id) || null;
			return { success: true, data: template };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findAll(): Promise<Result<ApprovalTemplate[]>> {
		try {
			const templates = Array.from(this.templates.values());
			return { success: true, data: templates };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findPublic(): Promise<Result<ApprovalTemplate[]>> {
		try {
			const publicTemplates = Array.from(this.templates.values()).filter((t) => t.isPublic);
			return { success: true, data: publicTemplates };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findByCategory(category: string): Promise<Result<ApprovalTemplate[]>> {
		try {
			const templates = Array.from(this.templates.values()).filter((t) => t.category === category);
			return { success: true, data: templates };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async update(id: string, template: ApprovalTemplate): Promise<Result<ApprovalTemplate>> {
		try {
			if (!this.templates.has(id)) {
				return {
					success: false,
					error: new Error(`Template with id ${id} not found`),
				};
			}
			this.templates.set(id, template);
			return { success: true, data: template };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async delete(id: string): Promise<Result<void>> {
		try {
			if (!this.templates.has(id)) {
				return {
					success: false,
					error: new Error(`Template with id ${id} not found`),
				};
			}
			this.templates.delete(id);
			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}
}
