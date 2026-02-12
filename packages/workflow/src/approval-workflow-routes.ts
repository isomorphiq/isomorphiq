import type { Request, Response } from "express";
import { Router } from "express";
import type { Result } from "@isomorphiq/core";
import type {
    ApprovalStats,
    ApprovalTemplate,
    CreateApprovalWorkflowInput,
    ProcessApprovalInput,
    StartTaskApprovalInput,
    TaskApproval,
    UpdateApprovalWorkflowInput,
} from "./approval-types.ts";
import type { IApprovalWorkflowService } from "./approval-workflow-service.ts";

type AuthRequest = Request & { user?: { id?: string } };

export function createApprovalWorkflowRoutes(
	approvalService: IApprovalWorkflowService,
	authMiddleware?: (_req: Request, _res: Response, _next: () => void) => void,
): Router {
	const router = Router();
	const withAuth = authMiddleware || ((_, __, next) => next());
	const getUserId = (req: AuthRequest): string | undefined => req.user?.id;
	const handleRouteError = (res: Response, error: unknown): void => {
		console.error("[APPROVAL-ROUTES] Internal server error:", error);
		res.status(500).json({ error: "Internal server error" });
	};

	// Workflow routes
	router.post("/workflows", withAuth, async (req: AuthRequest, res: Response) => {
		try {
			const input: CreateApprovalWorkflowInput = req.body;
			const result = await approvalService.workflow.create(input, getUserId(req));

			if (result.success) {
				res.status(201).json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	router.get("/workflows", withAuth, async (_req, res: Response) => {
		try {
			const result = await approvalService.workflow.getAll();

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(500).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	router.get("/workflows/:id", withAuth, async (req, res: Response) => {
		try {
			const result = await approvalService.workflow.get(req.params.id);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(404).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	router.put("/workflows/:id", withAuth, async (req: AuthRequest, res: Response) => {
		try {
			const input: UpdateApprovalWorkflowInput = { ...req.body, id: req.params.id };
			const result = await approvalService.workflow.update(req.params.id, input, getUserId(req));

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	router.delete("/workflows/:id", withAuth, async (req: AuthRequest, res: Response) => {
		try {
			const result = await approvalService.workflow.delete(req.params.id, getUserId(req));

			if (result.success) {
				res.status(204).send();
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	router.get("/workflows/active", withAuth, async (_req, res: Response) => {
		try {
			const result = await approvalService.workflow.getActive();

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(500).json({ error: result.error?.message });
			}
		} catch (error) {
			handleRouteError(res, error);
		}
	});

	// Approval routes
	router.post("/approvals/start", withAuth, async (req: AuthRequest, res: Response) => {
		try {
			const input: StartTaskApprovalInput = { ...req.body, requestedBy: getUserId(req) };
			const result = await approvalService.approval.start(input);

			if (result.success) {
				res.status(201).json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	router.get("/approvals", withAuth, async (req, res: Response) => {
		try {
			const { status, taskId, approverId } = req.query;
			const statusValue = typeof status === "string" ? status : undefined;
			const taskIdValue = typeof taskId === "string" ? taskId : undefined;
			const approverIdValue = typeof approverId === "string" ? approverId : undefined;

			let result: Result<TaskApproval[]>;
			if (statusValue === "pending") {
				result = await approvalService.approval.getPending();
			} else if (taskIdValue) {
				result = await approvalService.approval.getByTask(taskIdValue);
			} else if (approverIdValue) {
				result = await approvalService.approval.getByApprover(approverIdValue);
			} else {
				return res.status(400).json({ error: "Must specify status, taskId, or approverId" });
			}

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(500).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	router.get("/approvals/:id", withAuth, async (req, res: Response) => {
		try {
			const result = await approvalService.approval.get(req.params.id);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(404).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	router.post("/approvals/:id/process", withAuth, async (req: AuthRequest, res: Response) => {
		try {
			const input: ProcessApprovalInput = {
				...req.body,
				approvalId: req.params.id,
				approverId: getUserId(req),
			};
			const result = await approvalService.approval.process(input);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (error) {
			handleRouteError(res, error);
		}
	});

	router.post("/approvals/:id/cancel", withAuth, async (req: AuthRequest, res: Response) => {
		try {
			const { reason } = req.body;
			const result = await approvalService.approval.cancel(req.params.id, getUserId(req), reason);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (error) {
			handleRouteError(res, error);
		}
	});

	router.post("/approvals/:id/escalate", withAuth, async (req: AuthRequest, res: Response) => {
		try {
			const { stageId, reason } = req.body;
			const result = await approvalService.approval.escalate(
				req.params.id,
				stageId,
				getUserId(req),
				reason,
			);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (error) {
			handleRouteError(res, error);
		}
	});

	router.post("/approvals/:id/delegate", withAuth, async (req: AuthRequest, res: Response) => {
		try {
			const { stageId, toUserId } = req.body;
			const result = await approvalService.approval.delegate(
				req.params.id,
				stageId,
				getUserId(req),
				toUserId,
			);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (error) {
			handleRouteError(res, error);
		}
	});

	// Template routes
	router.post("/templates", withAuth, async (req: AuthRequest, res: Response) => {
		try {
			const input = { ...req.body, createdBy: getUserId(req) };
			const result = await approvalService.template.create(input);

			if (result.success) {
				res.status(201).json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	router.get("/templates", withAuth, async (req, res: Response) => {
		try {
			const { category, public: isPublic } = req.query;
			const categoryValue = typeof category === "string" ? category : undefined;
			const isPublicValue = typeof isPublic === "string" ? isPublic : undefined;

			let result: Result<ApprovalTemplate[]>;
			if (isPublicValue === "true") {
				result = await approvalService.template.getPublic();
			} else if (categoryValue) {
				result = await approvalService.template.getByCategory(categoryValue);
			} else {
				result = await approvalService.template.getAll();
			}

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(500).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	router.get("/templates/:id", withAuth, async (req, res: Response) => {
		try {
			const result = await approvalService.template.get(req.params.id);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(404).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	router.put("/templates/:id", withAuth, async (req, res: Response) => {
		try {
			const result = await approvalService.template.update(req.params.id, req.body);

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	router.delete("/templates/:id", withAuth, async (req, res: Response) => {
		try {
			const result = await approvalService.template.delete(req.params.id);

			if (result.success) {
				res.status(204).send();
			} else {
				res.status(400).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	// Stats routes
	router.get("/stats", withAuth, async (req: Request, res: Response) => {
		try {
			const { userId, workflowId } = req.query;
			const userIdValue = typeof userId === "string" ? userId : undefined;
			const workflowIdValue = typeof workflowId === "string" ? workflowId : undefined;

			let result: Result<ApprovalStats>;
			if (userIdValue) {
				result = await approvalService.stats.getUserStats(userIdValue);
			} else if (workflowIdValue) {
				result = await approvalService.stats.getWorkflowStats(workflowIdValue);
			} else {
				result = await approvalService.stats.getStats();
			}

			if (result.success) {
				res.json(result.data);
			} else {
				res.status(500).json({ error: result.error?.message });
			}
		} catch (error) {
            handleRouteError(res, error);
        }
	});

	return router;
}
