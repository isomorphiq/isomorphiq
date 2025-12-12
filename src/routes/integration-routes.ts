import type { Request, Response } from "express";
import { Router } from "express";
import { NotFoundError, ValidationError } from "../core/result.ts";
import type { IntegrationService } from "../integrations/integration-service.ts";

/**
 * Integration API routes
 */
export function createIntegrationRoutes(integrationService: IntegrationService): Router {
	const router = Router();

	// Get all integrations
	router.get("/", async (_req: Request, res: Response) => {
		try {
			const result = await integrationService.getAllIntegrations();

			if (!result.success) {
				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			res.json({
				success: true,
				data: result.data,
			});
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to get integrations:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Get integration by ID
	router.get("/:id", async (req: Request, res: Response) => {
		try {
			const { id } = req.params;

			if (!id) {
				return res.status(400).json({
					success: false,
					error: "Integration ID is required",
				});
			}

			const result = await integrationService.getIntegration(id);

			if (!result.success) {
				if (result.error instanceof NotFoundError) {
					return res.status(404).json({
						success: false,
						error: result.error.message,
					});
				}

				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			res.json({
				success: true,
				data: result.data,
			});
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to get integration:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Create new integration
	router.post("/", async (req: Request, res: Response) => {
		try {
			const config = req.body;

			if (!config) {
				return res.status(400).json({
					success: false,
					error: "Integration configuration is required",
				});
			}

			const result = await integrationService.createIntegration(config);

			if (!result.success) {
				if (result.error instanceof ValidationError) {
					return res.status(400).json({
						success: false,
						error: result.error.message,
					});
				}

				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			res.status(201).json({
				success: true,
				data: result.data,
			});
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to create integration:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Update integration
	router.put("/:id", async (req: Request, res: Response) => {
		try {
			const { id } = req.params;
			const updates = req.body;

			if (!id) {
				return res.status(400).json({
					success: false,
					error: "Integration ID is required",
				});
			}

			if (!updates) {
				return res.status(400).json({
					success: false,
					error: "Integration updates are required",
				});
			}

			const result = await integrationService.updateIntegration(id, updates);

			if (!result.success) {
				if (result.error instanceof NotFoundError) {
					return res.status(404).json({
						success: false,
						error: result.error.message,
					});
				}

				if (result.error instanceof ValidationError) {
					return res.status(400).json({
						success: false,
						error: result.error.message,
					});
				}

				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			res.json({
				success: true,
				data: result.data,
			});
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to update integration:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Delete integration
	router.delete("/:id", async (req: Request, res: Response) => {
		try {
			const { id } = req.params;

			if (!id) {
				return res.status(400).json({
					success: false,
					error: "Integration ID is required",
				});
			}

			const result = await integrationService.deleteIntegration(id);

			if (!result.success) {
				if (result.error instanceof NotFoundError) {
					return res.status(404).json({
						success: false,
						error: result.error.message,
					});
				}

				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			res.status(204).send();
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to delete integration:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Enable integration
	router.post("/:id/enable", async (req: Request, res: Response) => {
		try {
			const { id } = req.params;

			if (!id) {
				return res.status(400).json({
					success: false,
					error: "Integration ID is required",
				});
			}

			const result = await integrationService.enableIntegration(id);

			if (!result.success) {
				if (result.error instanceof NotFoundError) {
					return res.status(404).json({
						success: false,
						error: result.error.message,
					});
				}

				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			res.json({
				success: true,
				message: "Integration enabled successfully",
			});
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to enable integration:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Disable integration
	router.post("/:id/disable", async (req: Request, res: Response) => {
		try {
			const { id } = req.params;

			if (!id) {
				return res.status(400).json({
					success: false,
					error: "Integration ID is required",
				});
			}

			const result = await integrationService.disableIntegration(id);

			if (!result.success) {
				if (result.error instanceof NotFoundError) {
					return res.status(404).json({
						success: false,
						error: result.error.message,
					});
				}

				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			res.json({
				success: true,
				message: "Integration disabled successfully",
			});
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to disable integration:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Test integration connection
	router.post("/:id/test", async (req: Request, res: Response) => {
		try {
			const { id } = req.params;

			if (!id) {
				return res.status(400).json({
					success: false,
					error: "Integration ID is required",
				});
			}

			const result = await integrationService.testConnection(id);

			if (!result.success) {
				if (result.error instanceof NotFoundError) {
					return res.status(404).json({
						success: false,
						error: result.error.message,
					});
				}

				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			res.json({
				success: true,
				data: {
					connected: result.data,
					message: result.data ? "Connection successful" : "Connection failed",
				},
			});
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to test connection:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Sync integration
	router.post("/:id/sync", async (req: Request, res: Response) => {
		try {
			const { id } = req.params;
			const { syncType } = req.body;

			if (!id) {
				return res.status(400).json({
					success: false,
					error: "Integration ID is required",
				});
			}

			const result = await integrationService.syncIntegration(id, syncType);

			if (!result.success) {
				if (result.error instanceof NotFoundError) {
					return res.status(404).json({
						success: false,
						error: result.error.message,
					});
				}

				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			res.json({
				success: true,
				data: result.data,
			});
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to sync integration:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Sync all integrations
	router.post("/sync-all", async (_req: Request, res: Response) => {
		try {
			const result = await integrationService.syncAllIntegrations();

			if (!result.success) {
				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			res.json({
				success: true,
				data: result.data,
			});
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to sync all integrations:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Check integration health
	router.get("/:id/health", async (req: Request, res: Response) => {
		try {
			const { id } = req.params;

			if (!id) {
				return res.status(400).json({
					success: false,
					error: "Integration ID is required",
				});
			}

			const result = await integrationService.checkIntegrationHealth(id);

			if (!result.success) {
				if (result.error instanceof NotFoundError) {
					return res.status(404).json({
						success: false,
						error: result.error.message,
					});
				}

				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			res.json({
				success: true,
				data: result.data,
			});
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to check integration health:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Check all integrations health
	router.get("/health", async (_req: Request, res: Response) => {
		try {
			const result = await integrationService.checkAllIntegrationsHealth();

			if (!result.success) {
				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			res.json({
				success: true,
				data: result.data,
			});
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to check all integrations health:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Get integration statistics
	router.get("/stats", async (_req: Request, res: Response) => {
		try {
			const result = await integrationService.getIntegrationStats();

			if (!result.success) {
				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			res.json({
				success: true,
				data: result.data,
			});
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to get integration stats:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Get integration templates
	router.get("/templates", async (_req: Request, res: Response) => {
		try {
			const templates = integrationService.getIntegrationTemplates();

			res.json({
				success: true,
				data: templates,
			});
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to get integration templates:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	// Handle webhooks from external services
	router.post("/webhook/:type", async (req: Request, res: Response) => {
		try {
			const { type } = req.params;
			const signatureHeader = req.headers["x-hub-signature-256"] || req.headers["x-slack-signature"];
			const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
			const payload = req.body;

			if (!type) {
				return res.status(400).json({
					success: false,
					error: "Integration type is required",
				});
			}

			const result = await integrationService.handleWebhook(type, payload, signature);

			if (!result.success) {
				return res.status(500).json({
					success: false,
					error: result.error?.message,
				});
			}

			// Return 200 OK for webhook processing
			res.status(200).send("Webhook processed successfully");
		} catch (error) {
			console.error("[INTEGRATION-API] Failed to handle webhook:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
			});
		}
	});

	return router;
}
