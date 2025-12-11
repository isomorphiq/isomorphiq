import type { Request, Response } from "express";
import { Router } from "express";
import { authMiddleware } from "../auth-service.ts";
import type {
	ApprovalStats,
	ApprovalTemplate,
	CreateApprovalWorkflowInput,
	ProcessApprovalInput,
	StartTaskApprovalInput,
	TaskApproval,
	UpdateApprovalWorkflowInput,
} from "../core/approval-workflow.ts";
import type { Result } from "../core/result.ts";
import type { IApprovalWorkflowService } from "../services/approval-workflow-service.ts";

export function createApprovalWorkflowRoutes(approvalService: IApprovalWorkflowService): Router {
	const router = Router();

	// Workflow routes
	router.post("/workflows", authMiddleware, async (req: Request, res: Response) => {
		try {
			const input: CreateApprovalWorkflowInput = req.body;
			const result = await approvalService.workflow.create(input, req.user?.id);

			if (result.success) {
				res.status(201).json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/workflows", authMiddleware, async (_req: Request, res: Response) => {
		try {
			const result = await approvalService.workflow.getAll();

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(500).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/workflows/:id", authMiddleware, async (req: Request, res: Response) => {
		try {
			const result = await approvalService.workflow.get(req.params.id);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(404).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.put("/workflows/:id", authMiddleware, async (req: Request, res: Response) => {
		try {
			const input: UpdateApprovalWorkflowInput = { ...req.body, id: req.params.id };
			const result = await approvalService.workflow.update(req.params.id, input, req.user?.id);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.delete("/workflows/:id", authMiddleware, async (req: Request, res: Response) => {
		try {
			const result = await approvalService.workflow.delete(req.params.id, req.user?.id);

			if (result.success) {
				res.status(204).send();
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/workflows/active", authMiddleware, async (_req: Request, res: Response) => {
		try {
			const result = await approvalService.workflow.getActive();

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(500).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	// Approval routes
	router.post("/approvals/start", authMiddleware, async (req: Request, res: Response) => {
		try {
			const input: StartTaskApprovalInput = { ...req.body, requestedBy: req.user?.id };
			const result = await approvalService.approval.start(input);

			if (result.success) {
				res.status(201).json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/approvals", authMiddleware, async (req: Request, res: Response) => {
		try {
			const { status, taskId, approverId } = req.query;

			let result: Result<TaskApproval[]>;
			if (status === "pending") {
				result = await approvalService.approval.getPending();
			} else if (taskId) {
				result = await approvalService.approval.getByTask(taskId as string);
			} else if (approverId) {
				result = await approvalService.approval.getByApprover(approverId as string);
			} else {
				return res.status(400).json({ error: "Must specify status, taskId, or approverId" });
			}

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(500).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/approvals/:id", authMiddleware, async (req: Request, res: Response) => {
		try {
			const result = await approvalService.approval.get(req.params.id);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(404).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/approvals/:id/process", authMiddleware, async (req: Request, res: Response) => {
		try {
			const input: ProcessApprovalInput = {
				...req.body,
				approvalId: req.params.id,
				approverId: req.user?.id,
			};
			const result = await approvalService.approval.process(input);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/approvals/:id/cancel", authMiddleware, async (req: Request, res: Response) => {
		try {
			const { reason } = req.body;
			const result = await approvalService.approval.cancel(req.params.id, req.user?.id, reason);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/approvals/:id/escalate", authMiddleware, async (req: Request, res: Response) => {
		try {
			const { stageId, reason } = req.body;
			const result = await approvalService.approval.escalate(
				req.params.id,
				stageId,
				req.user?.id,
				reason,
			);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/approvals/:id/delegate", authMiddleware, async (req: Request, res: Response) => {
		try {
			const { stageId, toUserId } = req.body;
			const result = await approvalService.approval.delegate(
				req.params.id,
				stageId,
				req.user?.id,
				toUserId,
			);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	// Template routes
	router.post("/templates", authMiddleware, async (req: Request, res: Response) => {
		try {
			const input = { ...req.body, createdBy: req.user?.id };
			const result = await approvalService.template.create(input);

			if (result.success) {
				res.status(201).json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/templates", authMiddleware, async (req: Request, res: Response) => {
		try {
			const { category, public: isPublic } = req.query;

			let result: Result<ApprovalTemplate[]>;
			if (isPublic === "true") {
				result = await approvalService.template.getPublic();
			} else if (category) {
				result = await approvalService.template.getByCategory(category as string);
			} else {
				result = await approvalService.template.getAll();
			}

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(500).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/templates/:id", authMiddleware, async (req: Request, res: Response) => {
		try {
			const result = await approvalService.template.get(req.params.id);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(404).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.put("/templates/:id", authMiddleware, async (req: Request, res: Response) => {
		try {
			const result = await approvalService.template.update(req.params.id, req.body);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	router.delete("/templates/:id", authMiddleware, async (req: Request, res: Response) => {
		try {
			const result = await approvalService.template.delete(req.params.id);

			if (result.success) {
				res.status(204).send();
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	// Stats routes
	router.get("/stats", authMiddleware, async (req: Request, res: Response) => {
		try {
			const { userId, workflowId } = req.query;

			let result: Result<ApprovalStats>;
			if (userId) {
				result = await approvalService.stats.getUserStats(userId as string);
			} else if (workflowId) {
				result = await approvalService.stats.getWorkflowStats(workflowId as string);
			} else {
				result = await approvalService.stats.getStats();
			}

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(500).json({ error: result.error?.message });
			}
		} catch (_error) {
			res.status(500).json({ error: "Internal server error" });
		}
	});

	return router;
}
