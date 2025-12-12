import express from "express";
import { getSecurityService } from "../services/security-service.ts";
import type {
	AuditLog,
	CreateSecurityAlertInput,
	CreateSecurityPolicyInput,
	SecurityAlert,
	SecurityAlertType,
	SecuritySearchFilters,
	UpdateSecurityPolicyInput,
} from "../types/security-types.ts";
import type { User } from "../types.ts";
import { getUserManager } from "../user-manager.ts";

// Authentication middleware
const authenticateToken = async (
	req: express.Request,
	res: express.Response,
	next: express.NextFunction,
) => {
	const authHeader = req.headers.authorization;
	const token = authHeader?.split(" ")[1];

	if (!token) {
		return res.status(401).json({ error: "Access token required" });
	}

	try {
		const userManager = getUserManager();
		const user = await userManager.validateSession(token);

		if (!user) {
			return res.status(401).json({ error: "Invalid or expired token" });
		}

		(req as unknown as { user?: User }).user = user;
		next();
	} catch (error) {
		console.error("[SECURITY-ROUTES] Authentication error:", error);
		return res.status(500).json({ error: "Authentication failed" });
	}
};

// Authorization middleware
const requirePermission = (resource: string, action: string) => {
	return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
		const user = (req as unknown as { user?: User }).user;

		if (!user) {
			return res.status(401).json({ error: "Authentication required" });
		}

		try {
			const userManager = getUserManager();
			const hasPermission = await userManager.hasPermission(user, resource, action);

			if (!hasPermission) {
				return res.status(403).json({ error: "Insufficient permissions" });
			}

			next();
		} catch (error) {
			console.error("[SECURITY-ROUTES] Authorization error:", error);
			return res.status(500).json({ error: "Authorization failed" });
		}
	};
};

// Security Policy Routes
export function createSecurityRoutes(): express.Router {
	const router = express.Router();
	const securityService = getSecurityService();

	// Initialize default security policy
	router.post(
		"/policies/initialize",
		authenticateToken,
		requirePermission("system", "manage"),
		async (_req, res, next) => {
			try {
				const policy = await securityService.initializeDefaultSecurityPolicy();
				res.json({ policy, message: "Default security policy initialized" });
			} catch (error) {
				next(error);
			}
		},
	);

	// Create security policy
	router.post(
		"/policies",
		authenticateToken,
		requirePermission("system", "manage"),
		async (req, res, next) => {
			try {
				const input = req.body as CreateSecurityPolicyInput;
				const policy = await securityService.createSecurityPolicy(input);
				res.status(201).json({ policy });
			} catch (error) {
				next(error);
			}
		},
	);

	// Get all security policies
	router.get(
		"/policies",
		authenticateToken,
		requirePermission("system", "view_logs"),
		async (_req, res, next) => {
			try {
				const policies = await securityService.getAllSecurityPolicies();
				res.json({ policies, count: policies.length });
			} catch (error) {
				next(error);
			}
		},
	);

	// Get specific security policy
	router.get(
		"/policies/:id",
		authenticateToken,
		requirePermission("system", "view_logs"),
		async (req, res, next) => {
			try {
				const { id } = req.params;
				if (!id) {
					return res.status(400).json({ error: "Policy ID is required" });
				}
				const policy = await securityService.getSecurityPolicy(id);
				if (!policy) {
					return res.status(404).json({ error: "Security policy not found" });
				}
				res.json({ policy });
			} catch (error) {
				next(error);
			}
		},
	);

	// Update security policy
	router.put(
		"/policies/:id",
		authenticateToken,
		requirePermission("system", "manage"),
		async (req, res, next) => {
			try {
				const { id } = req.params;
				const input = req.body as UpdateSecurityPolicyInput;
				if (!id) {
					return res.status(400).json({ error: "Policy ID is required" });
				}
				const policy = await securityService.updateSecurityPolicy({ ...input, id });
				res.json({ policy });
			} catch (error) {
				next(error);
			}
		},
	);

	// Audit Log Routes
	router.get(
		"/audit",
		authenticateToken,
		requirePermission("system", "view_logs"),
		async (req, res, next) => {
			try {
				const filters: SecuritySearchFilters = {
					dateFrom: req.query.dateFrom as string,
					dateTo: req.query.dateTo as string,
					userId: req.query.userId as string,
					action: req.query.action as string,
					resource: req.query.resource as string,
					outcome: req.query.outcome as AuditLog["outcome"],
					riskLevel: req.query.riskLevel as AuditLog["riskLevel"],
					category: req.query.category as AuditLog["category"],
				};

				const logs = await securityService.getAuditLogs(filters);
				res.json({ logs, count: logs.length });
			} catch (error) {
				next(error);
			}
		},
	);

	// Security Alert Routes
	router.get(
		"/alerts",
		authenticateToken,
		requirePermission("system", "view_logs"),
		async (req, res, next) => {
			try {
				const filters: SecuritySearchFilters = {
					dateFrom: req.query.dateFrom as string,
					dateTo: req.query.dateTo as string,
					userId: req.query.userId as string,
					severities: typeof req.query.severities === "string"
						? (req.query.severities as string)
								.split(",")
								.filter(
									(severity): severity is SecurityAlert["severity"] =>
										["low", "medium", "high", "critical"].includes(severity),
								)
						: undefined,
					alertTypes: typeof req.query.alertTypes === "string"
						? (req.query.alertTypes as string)
								.split(",")
								.filter((type): type is SecurityAlertType => type.length > 0)
						: undefined,
					status: req.query.status as SecurityAlert["status"],
				};

				const alerts = await securityService.getSecurityAlerts(filters);
				res.json({ alerts, count: alerts.length });
			} catch (error) {
				next(error);
			}
		},
	);

	// Create security alert
	router.post(
		"/alerts",
		authenticateToken,
		requirePermission("system", "manage"),
		async (req, res, next) => {
			try {
				const input = req.body as CreateSecurityAlertInput;
				const alert = await securityService.createSecurityAlert(input);
				res.status(201).json({ alert });
			} catch (error) {
				next(error);
			}
		},
	);

	// Update security alert status
	router.put(
		"/alerts/:id/status",
		authenticateToken,
		requirePermission("system", "manage"),
		async (req, res, next) => {
			try {
				const { id } = req.params;
				const { status, resolutionNotes } = req.body;
				if (!id) {
					return res.status(400).json({ error: "Alert ID is required" });
				}
				const alert = await securityService.updateSecurityAlertStatus(id, status, resolutionNotes);
				res.json({ alert });
			} catch (error) {
				next(error);
			}
		},
	);

	// Security Dashboard
	router.get(
		"/dashboard",
		authenticateToken,
		requirePermission("analytics", "read"),
		async (_req, res, next) => {
			try {
				const dashboardData = await securityService.getSecurityDashboardData();
				res.json(dashboardData);
			} catch (error) {
				next(error);
			}
		},
	);

	// Security Metrics
	router.get(
		"/metrics",
		authenticateToken,
		requirePermission("analytics", "read"),
		async (req, res, next) => {
			try {
				const { startDate, endDate } = req.query;
				if (!startDate || !endDate) {
					return res.status(400).json({ error: "startDate and endDate are required" });
				}

				const metrics = await securityService.generateSecurityMetrics(
					new Date(startDate as string),
					new Date(endDate as string),
				);
				res.json({ metrics });
			} catch (error) {
				next(error);
			}
		},
	);

	// Security Reports
	router.post(
		"/reports",
		authenticateToken,
		requirePermission("reports", "create"),
		async (req, res, next) => {
			try {
				const { type, startDate, endDate } = req.body;
				if (!type || !startDate || !endDate) {
					return res.status(400).json({ error: "type, startDate, and endDate are required" });
				}

				const report = await securityService.generateSecurityReport(
					type,
					new Date(startDate),
					new Date(endDate),
				);
				res.status(201).json({ report });
			} catch (error) {
				next(error);
			}
		},
	);

	// Data Encryption Demo
	router.post(
		"/encrypt",
		authenticateToken,
		requirePermission("system", "manage"),
		async (req, res, next) => {
			try {
				const { data, keyId } = req.body;
				if (!data) {
					return res.status(400).json({ error: "data is required" });
				}

				const encryptedField = securityService.encryptSensitiveData(data, keyId);
				res.json({ encryptedField });
			} catch (error) {
				next(error);
			}
		},
	);

	router.post(
		"/decrypt",
		authenticateToken,
		requirePermission("system", "manage"),
		async (req, res, next) => {
			try {
				const { encryptedField } = req.body;
				if (!encryptedField) {
					return res.status(400).json({ error: "encryptedField is required" });
				}

				const decryptedData = securityService.decryptSensitiveData(encryptedField);
				res.json({ data: decryptedData });
			} catch (error) {
				next(error);
			}
		},
	);

	// Cleanup Operations
	router.post(
		"/cleanup",
		authenticateToken,
		requirePermission("system", "manage"),
		async (_req, res, next) => {
			try {
				await securityService.cleanupExpiredData();
				res.json({ message: "Security data cleanup completed" });
			} catch (error) {
				next(error);
			}
		},
	);

	return router;
}
