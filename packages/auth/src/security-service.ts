import crypto from "node:crypto";
import path from "node:path";
import { Level } from "level";
import type {
    AuditLog,
    CreateAuditLogInput,
    CreateSecurityAlertInput,
    CreateSecurityPolicyInput,
    EncryptedField,
    EncryptionKey,
    SecurityAlert,
    SecurityDashboardData,
    SecurityFinding,
    SecurityMetrics,
    SecurityPolicy,
    SecurityRecommendation,
    SecurityReport,
    SecuritySearchFilters,
    UpdateSecurityPolicyInput,
} from "./security-types.ts";

export class SecurityService {
	private securityDb!: Level<string, SecurityPolicy>;
	private auditDb!: Level<string, AuditLog>;
	private alertsDb!: Level<string, SecurityAlert>;
	private encryptionKeysDb!: Level<string, EncryptionKey>;
	private dbReady = false;
	private encryptionKey: string;

	constructor() {
		// Initialize databases
		const securityDbPath = path.join(process.cwd(), "db", "security");
		const auditDbPath = path.join(process.cwd(), "db", "audit");
		const alertsDbPath = path.join(process.cwd(), "db", "security-alerts");
		const encryptionKeysDbPath = path.join(process.cwd(), "db", "encryption-keys");

		this.securityDb = new Level(securityDbPath, { valueEncoding: "json" });
		this.auditDb = new Level(auditDbPath, { valueEncoding: "json" });
		this.alertsDb = new Level(alertsDbPath, { valueEncoding: "json" });
		this.encryptionKeysDb = new Level(encryptionKeysDbPath, { valueEncoding: "json" });

		// Initialize encryption key from environment or generate one
		this.encryptionKey = process.env.ENCRYPTION_KEY || this.generateEncryptionKey();
	}

	private async ensureDatabasesOpen(): Promise<void> {
		if (!this.dbReady) {
			try {
				await this.securityDb.open();
				await this.auditDb.open();
				await this.alertsDb.open();
				await this.encryptionKeysDb.open();
				this.dbReady = true;
				console.log("[SECURITY-SERVICE] Security databases opened successfully");
			} catch (error) {
				console.error("[SECURITY-SERVICE] Failed to open databases:", error);
				throw error;
			}
		}
	}

	private generateEncryptionKey(): string {
		return crypto.randomBytes(32).toString("hex");
	}

	// Initialize default security policy
	async initializeDefaultSecurityPolicy(): Promise<SecurityPolicy> {
		await this.ensureDatabasesOpen();

		const defaultPolicy: SecurityPolicy = {
			id: "default-security-policy",
			name: "Default Security Policy",
			description: "Enterprise-grade security configuration",
			version: "1.0.0",
			enabled: true,
			createdAt: new Date(),
			updatedAt: new Date(),
			settings: {
				passwordPolicy: {
					minLength: 12,
					requireUppercase: true,
					requireLowercase: true,
					requireNumbers: true,
					requireSpecialChars: true,
					preventReuse: 10,
					maxAge: 90,
				},
				sessionPolicy: {
					maxConcurrentSessions: 3,
					sessionTimeoutMinutes: 30,
					idleTimeoutMinutes: 15,
					rememberMeDays: 30,
					requireReauthMinutes: 60,
				},
				accessPolicy: {
					maxFailedAttempts: 5,
					lockoutDurationMinutes: 30,
					passwordHistoryCount: 10,
					requireMfa: false,
					allowedIpRanges: [],
					blockedIpRanges: [],
					geoRestrictions: [],
				},
				encryptionPolicy: {
					dataAtRest: {
						algorithm: "AES-256-GCM",
						keyRotationDays: 90,
						enabled: true,
					},
					dataInTransit: {
						tlsVersion: "1.3",
						cipherSuites: ["TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256"],
						enabled: true,
					},
					fieldEncryption: {
						enabledFields: ["email", "phone", "ssn", "creditCard"],
						algorithm: "AES-256-GCM",
						keyId: "default-key",
					},
				},
				auditPolicy: {
					logLevel: "info",
					retentionDays: 365,
					logFailedAttempts: true,
					logDataAccess: true,
					logAdminActions: true,
					realTimeAlerts: true,
				},
				compliancePolicy: {
					frameworks: [
						{
							name: "GDPR",
							version: "2018",
							enabled: true,
							requirements: [
								{
									id: "GDPR-1",
									name: "Lawful basis for processing",
									description: "Ensure lawful basis for all data processing",
									category: "Data Protection",
									mandatory: true,
									implemented: true,
								},
								{
									id: "GDPR-2",
									name: "Data subject rights",
									description: "Implement data subject access and erasure rights",
									category: "Privacy Rights",
									mandatory: true,
									implemented: true,
								},
							],
							status: "compliant",
						},
						{
							name: "SOC2",
							version: "2017",
							enabled: true,
							requirements: [
								{
									id: "SOC2-1",
									name: "Security controls",
									description: "Implement appropriate security controls",
									category: "Security",
									mandatory: true,
									implemented: true,
								},
							],
							status: "compliant",
						},
					],
					dataClassification: {
						levels: [
							{
								name: "public",
								description: "Public information that can be freely shared",
								encryptionRequired: false,
								accessLogging: false,
								approvalRequired: false,
							},
							{
								name: "internal",
								description: "Internal company information",
								encryptionRequired: true,
								accessLogging: true,
								approvalRequired: false,
							},
							{
								name: "confidential",
								description: "Confidential business information",
								encryptionRequired: true,
								accessLogging: true,
								retentionDays: 2555,
								approvalRequired: true,
							},
							{
								name: "restricted",
								description: "Highly sensitive restricted information",
								encryptionRequired: true,
								accessLogging: true,
								retentionDays: 2555,
								approvalRequired: true,
							},
						],
						defaultLevel: "internal",
						fieldMappings: {
							email: "confidential",
							phone: "confidential",
							ssn: "restricted",
							creditCard: "restricted",
						},
					},
					privacySettings: {
						dataMinimization: true,
						purposeLimitation: true,
						consentManagement: true,
						rightToErasure: true,
						dataPortability: true,
						anonymization: true,
					},
				},
			},
		};

		try {
			await this.securityDb.put(defaultPolicy.id, defaultPolicy);
			console.log("[SECURITY-SERVICE] Default security policy initialized");
			return defaultPolicy;
		} catch (error) {
			console.error("[SECURITY-SERVICE] Failed to initialize default policy:", error);
			throw error;
		}
	}

	// Security Policy Management
	async createSecurityPolicy(input: CreateSecurityPolicyInput): Promise<SecurityPolicy> {
		await this.ensureDatabasesOpen();

		const id = `policy-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
		const policy: SecurityPolicy = {
			id,
			name: input.name,
			description: input.description,
			version: "1.0.0",
			enabled: true,
			createdAt: new Date(),
			updatedAt: new Date(),
			settings: input.settings,
		};

		try {
			await this.securityDb.put(id, policy);
			await this.logAuditEvent({
				action: "create_security_policy",
				resource: "security_policy",
				resourceId: id,
				outcome: "success",
				details: { policyName: input.name },
				riskLevel: "medium",
				category: "admin_action",
			});
			console.log(`[SECURITY-SERVICE] Created security policy: ${input.name}`);
			return policy;
		} catch (error) {
			await this.logAuditEvent({
				action: "create_security_policy",
				resource: "security_policy",
				outcome: "failure",
				details: { policyName: input.name, error: String(error) },
				riskLevel: "medium",
				category: "admin_action",
			});
			throw error;
		}
	}

	async getSecurityPolicy(id: string): Promise<SecurityPolicy | null> {
		await this.ensureDatabasesOpen();
		try {
			return await this.securityDb.get(id);
		} catch (_error) {
			void _error;
			return null;
		}
	}

	async getAllSecurityPolicies(): Promise<SecurityPolicy[]> {
		await this.ensureDatabasesOpen();

		const policies: SecurityPolicy[] = [];
		try {
			const iterator = this.securityDb.iterator();
			for await (const [, value] of iterator) {
				if (value.id && value.name) {
					policies.push(value);
				}
			}
			await iterator.close();
		} catch (error) {
			console.error("[SECURITY-SERVICE] Error reading security policies:", error);
		}

		return policies;
	}

	async updateSecurityPolicy(input: UpdateSecurityPolicyInput): Promise<SecurityPolicy> {
		await this.ensureDatabasesOpen();

		const policy = await this.securityDb.get(input.id);
		if (!policy) {
			throw new Error("Security policy not found");
		}

		const updatedPolicy: SecurityPolicy = {
			...policy,
			updatedAt: new Date(),
		};

		if (input.name) updatedPolicy.name = input.name;
		if (input.description) updatedPolicy.description = input.description;
		if (input.settings) {
			updatedPolicy.settings = {
				...policy.settings,
				...input.settings,
			};
		}
		if (input.enabled !== undefined) updatedPolicy.enabled = input.enabled;

		try {
			await this.securityDb.put(input.id, updatedPolicy);
			await this.logAuditEvent({
				action: "update_security_policy",
				resource: "security_policy",
				resourceId: input.id,
				outcome: "success",
				details: { policyName: updatedPolicy.name },
				riskLevel: "medium",
				category: "admin_action",
			});
			console.log(`[SECURITY-SERVICE] Updated security policy: ${updatedPolicy.name}`);
			return updatedPolicy;
		} catch (error) {
			await this.logAuditEvent({
				action: "update_security_policy",
				resource: "security_policy",
				resourceId: input.id,
				outcome: "failure",
				details: { policyName: updatedPolicy.name, error: String(error) },
				riskLevel: "medium",
				category: "admin_action",
			});
			throw error;
		}
	}

	// Data Encryption
	encryptSensitiveData(data: string, keyId?: string): EncryptedField {
		const iv = crypto.randomBytes(16);
		const key = Buffer.from(this.encryptionKey, "hex");
		const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

		let encrypted = cipher.update(data, "utf8", "hex");
		encrypted += cipher.final("hex");

		const authTag = cipher.getAuthTag();

		return {
			fieldName: "sensitive_data",
			keyId: keyId || "default-key",
			algorithm: "AES-256-GCM",
			iv: iv.toString("hex"),
			encryptedData: `${encrypted}:${authTag.toString("hex")}`,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	}

	decryptSensitiveData(encryptedField: EncryptedField): string {
		const parts = encryptedField.encryptedData.split(":");
		if (parts.length !== 2) {
			throw new Error("Invalid encrypted data format");
		}
		const [encrypted, authTagHex] = parts;
		if (!encrypted || !authTagHex) {
			throw new Error("Invalid encrypted data format");
		}

		const iv = Buffer.from(encryptedField.iv, "hex");
		const authTag = Buffer.from(authTagHex, "hex");
		const key = Buffer.from(this.encryptionKey, "hex");

		const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(authTag);

		let decrypted = decipher.update(encrypted, "hex", "utf8");
		decrypted += decipher.final("utf8");

		return decrypted;
	}

	// Audit Logging
	async logAuditEvent(input: CreateAuditLogInput): Promise<AuditLog> {
		await this.ensureDatabasesOpen();

		const id = `audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
		const auditLog: AuditLog = {
			id,
			timestamp: new Date(),
			userId: input.userId,
			userRole: input.userRole,
			action: input.action,
			resource: input.resource,
			resourceId: input.resourceId,
			outcome: input.outcome,
			ipAddress: input.ipAddress,
			userAgent: input.userAgent,
			details: input.details,
			riskLevel: input.riskLevel,
			category: input.category,
			complianceTags: input.complianceTags || [],
			sessionId: input.sessionId,
		};

		try {
			await this.auditDb.put(id, auditLog);

			// Check for real-time alerts
			if (input.riskLevel === "high" || input.riskLevel === "critical") {
				await this.checkForSecurityAlerts(auditLog);
			}

			return auditLog;
		} catch (error) {
			console.error("[SECURITY-SERVICE] Failed to log audit event:", error);
			throw error;
		}
	}

	async getAuditLogs(filters?: SecuritySearchFilters): Promise<AuditLog[]> {
		await this.ensureDatabasesOpen();

		const logs: AuditLog[] = [];
		try {
			const iterator = this.auditDb.iterator();
			for await (const [, value] of iterator) {
				if (this.matchesFilters(value, filters)) {
					logs.push(value);
				}
			}
			await iterator.close();
		} catch (error) {
			console.error("[SECURITY-SERVICE] Error reading audit logs:", error);
		}

		return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	}

	private matchesFilters(log: AuditLog, filters?: SecuritySearchFilters): boolean {
		if (!filters) return true;

		if (filters.dateFrom && new Date(log.timestamp) < new Date(filters.dateFrom)) return false;
		if (filters.dateTo && new Date(log.timestamp) > new Date(filters.dateTo)) return false;
		if (filters.userId && log.userId !== filters.userId) return false;
		if (filters.action && !log.action.includes(filters.action)) return false;
		if (filters.resource && log.resource !== filters.resource) return false;
		if (filters.outcome && log.outcome !== filters.outcome) return false;
		if (filters.riskLevel && log.riskLevel !== filters.riskLevel) return false;
		if (filters.category && log.category !== filters.category) return false;

		return true;
	}

	// Security Alerts
	async createSecurityAlert(input: CreateSecurityAlertInput): Promise<SecurityAlert> {
		await this.ensureDatabasesOpen();

		const id = `alert-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
		const alert: SecurityAlert = {
			id,
			timestamp: new Date(),
			type: input.type,
			severity: input.severity,
			title: input.title,
			description: input.description,
			userId: input.userId,
			ipAddress: input.ipAddress,
			details: input.details,
			status: "open",
			relatedAuditLogs: input.relatedAuditLogs || [],
		};

		try {
			await this.alertsDb.put(id, alert);
			console.log(`[SECURITY-SERVICE] Created security alert: ${input.title}`);
			return alert;
		} catch (error) {
			console.error("[SECURITY-SERVICE] Failed to create security alert:", error);
			throw error;
		}
	}

	async getSecurityAlerts(filters?: SecuritySearchFilters): Promise<SecurityAlert[]> {
		await this.ensureDatabasesOpen();

		const alerts: SecurityAlert[] = [];
		try {
			const iterator = this.alertsDb.iterator();
			for await (const [, value] of iterator) {
				if (this.matchesAlertFilters(value, filters)) {
					alerts.push(value);
				}
			}
			await iterator.close();
		} catch (error) {
			console.error("[SECURITY-SERVICE] Error reading security alerts:", error);
		}

		return alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	}

	private matchesAlertFilters(alert: SecurityAlert, filters?: SecuritySearchFilters): boolean {
		if (!filters) return true;

		if (filters.dateFrom && new Date(alert.timestamp) < new Date(filters.dateFrom)) return false;
		if (filters.dateTo && new Date(alert.timestamp) > new Date(filters.dateTo)) return false;
		if (filters.userId && alert.userId !== filters.userId) return false;
		if (filters.severities && !filters.severities.includes(alert.severity)) return false;
		if (filters.alertTypes && !filters.alertTypes.includes(alert.type)) return false;
		if (filters.status && alert.status !== filters.status) return false;

		return true;
	}

	async updateSecurityAlertStatus(
		id: string,
		status: SecurityAlert["status"],
		resolutionNotes?: string,
	): Promise<SecurityAlert> {
		await this.ensureDatabasesOpen();

		const alert = await this.alertsDb.get(id);
		if (!alert) {
			throw new Error("Security alert not found");
		}

		const updatedAlert: SecurityAlert = {
			...alert,
			status,
			resolvedAt: status === "resolved" ? new Date() : undefined,
			resolutionNotes,
		};

		try {
			await this.alertsDb.put(id, updatedAlert);
			console.log(`[SECURITY-SERVICE] Updated security alert status: ${id} -> ${status}`);
			return updatedAlert;
		} catch (error) {
			console.error("[SECURITY-SERVICE] Failed to update security alert:", error);
			throw error;
		}
	}

	private async checkForSecurityAlerts(auditLog: AuditLog): Promise<void> {
		// Check for suspicious patterns
		if (auditLog.action === "login" && auditLog.outcome === "failure") {
			// Check for multiple failed logins
			const recentFailures = await this.getRecentFailedLogins(
				auditLog.userId || auditLog.ipAddress,
			);
			if (recentFailures.length >= 5) {
				await this.createSecurityAlert({
					type: "brute_force_attack",
					severity: "high",
					title: "Multiple Failed Login Attempts Detected",
					description: `Detected ${recentFailures.length} failed login attempts`,
					userId: auditLog.userId,
					ipAddress: auditLog.ipAddress,
					details: { attempts: recentFailures.length, timeWindow: "5 minutes" },
					relatedAuditLogs: recentFailures.map((log) => log.id),
				});
			}
		}

		if (auditLog.category === "admin_action" && auditLog.riskLevel === "critical") {
			await this.createSecurityAlert({
				type: "privilege_escalation",
				severity: "critical",
				title: "Critical Admin Action Detected",
				description: `Critical admin action performed: ${auditLog.action}`,
				userId: auditLog.userId,
				details: auditLog.details,
				relatedAuditLogs: [auditLog.id],
			});
		}
	}

	private async getRecentFailedLogins(identifier?: string): Promise<AuditLog[]> {
		if (!identifier) return [];

		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
		const logs = await this.getAuditLogs({
			dateFrom: fiveMinutesAgo.toISOString(),
			action: "login",
			outcome: "failure",
		});

		return logs.filter((log) => log.userId === identifier || log.ipAddress === identifier);
	}

	// Security Metrics and Reporting
	async generateSecurityMetrics(startDate: Date, endDate: Date): Promise<SecurityMetrics> {
		await this.ensureDatabasesOpen();

		const logs = await this.getAuditLogs({
			dateFrom: startDate.toISOString(),
			dateTo: endDate.toISOString(),
		});

		const alerts = await this.getSecurityAlerts({
			dateFrom: startDate.toISOString(),
			dateTo: endDate.toISOString(),
		});

		// Calculate metrics
		const authentication = {
			totalLogins: logs.filter((log) => log.action === "login").length,
			successfulLogins: logs.filter((log) => log.action === "login" && log.outcome === "success")
				.length,
			failedLogins: logs.filter((log) => log.action === "login" && log.outcome === "failure")
				.length,
			uniqueUsers: new Set(logs.filter((log) => log.userId).map((log) => log.userId)).size,
			mfaUsage: logs.filter((log) => log.action === "mfa_verification").length,
		};

		const authorization = {
			totalAccessRequests: logs.filter((log) => log.category === "authorization").length,
			grantedRequests: logs.filter(
				(log) => log.category === "authorization" && log.outcome === "success",
			).length,
			deniedRequests: logs.filter(
				(log) => log.category === "authorization" && log.outcome === "failure",
			).length,
			privilegeEscalationAttempts: logs.filter((log) => log.action.includes("escalate")).length,
		};

		const dataSecurity = {
			encryptedFields: 0, // Would be calculated from encrypted data
			dataAccessEvents: logs.filter((log) => log.category === "data_access").length,
			dataModificationEvents: logs.filter((log) => log.category === "data_modification").length,
			sensitiveDataAccess: logs.filter(
				(log) => log.riskLevel === "high" || log.riskLevel === "critical",
			).length,
		};

		const compliance = {
			totalRequirements: 0, // Would be calculated from compliance framework
			compliantRequirements: 0,
			auditEvents: logs.filter((log) => log.category === "compliance").length,
			violations: alerts.filter((alert) => alert.type === "compliance_violation").length,
		};

		const alertsSummary = {
			totalAlerts: alerts.length,
			criticalAlerts: alerts.filter((alert) => alert.severity === "critical").length,
			resolvedAlerts: alerts.filter((alert) => alert.status === "resolved").length,
			openAlerts: alerts.filter((alert) => alert.status === "open").length,
		};

		return {
			id: `metrics-${Date.now()}`,
			period: { start: startDate, end: endDate },
			authentication,
			authorization,
			dataSecurity,
			compliance,
			alerts: alertsSummary,
		};
	}

	async generateSecurityReport(
		type: SecurityReport["type"],
		startDate: Date,
		endDate: Date,
	): Promise<SecurityReport> {
		await this.ensureDatabasesOpen();

		const metrics = await this.generateSecurityMetrics(startDate, endDate);
		const alerts = await this.getSecurityAlerts({
			dateFrom: startDate.toISOString(),
			dateTo: endDate.toISOString(),
		});

		// Generate findings based on data
		const findings: SecurityFinding[] = [];
		const recommendations: SecurityRecommendation[] = [];

		// Analyze failed logins
		if (metrics.authentication.failedLogins > metrics.authentication.successfulLogins * 0.1) {
			findings.push({
				id: `finding-${Date.now()}-1`,
				category: "Authentication",
				severity: "high",
				title: "High Rate of Failed Login Attempts",
				description: `Failed login rate is ${((metrics.authentication.failedLogins / metrics.authentication.totalLogins) * 100).toFixed(1)}%`,
				evidence: [`Total failed logins: ${metrics.authentication.failedLogins}`],
				impact: "Potential brute force attacks or credential stuffing",
				affectedResources: ["Authentication System"],
			});

			recommendations.push({
				id: `rec-${Date.now()}-1`,
				category: "Authentication",
				priority: "high",
				title: "Implement Enhanced Authentication Controls",
				description: "Strengthen authentication mechanisms to prevent brute force attacks",
				steps: [
					"Implement account lockout policies",
					"Add CAPTCHA for repeated failed attempts",
					"Enable multi-factor authentication",
					"Monitor for suspicious IP addresses",
				],
				estimatedEffort: "2-3 days",
			});
		}

		// Analyze open critical alerts
		const openCriticalAlerts = alerts.filter(
			(alert) => alert.severity === "critical" && alert.status === "open",
		);
		if (openCriticalAlerts.length > 0) {
			findings.push({
				id: `finding-${Date.now()}-2`,
				category: "Security Incidents",
				severity: "critical",
				title: "Unresolved Critical Security Alerts",
				description: `${openCriticalAlerts.length} critical security alerts remain unresolved`,
				evidence: openCriticalAlerts.map((alert) => `Alert: ${alert.title}`),
				impact: "Potential security breaches and compliance violations",
				affectedResources: ["Security Operations"],
			});
		}

		const report: SecurityReport = {
			id: `report-${Date.now()}`,
			type,
			title: `${type.charAt(0).toUpperCase() + type.slice(1)} Report`,
			description: `Security ${type} report for period ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`,
			generatedAt: new Date(),
			period: { start: startDate, end: endDate },
			metrics,
			findings,
			recommendations,
			status: "draft",
		};

		return report;
	}

	// Security Dashboard
	async getSecurityDashboardData(): Promise<SecurityDashboardData> {
		await this.ensureDatabasesOpen();

		const now = new Date();
		const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

		const recentLogs = await this.getAuditLogs({
			dateFrom: twentyFourHoursAgo.toISOString(),
		});

		const recentAlerts = await this.getSecurityAlerts({
			dateFrom: twentyFourHoursAgo.toISOString(),
		});

		const openAlerts = await this.getSecurityAlerts({ status: "open" });

		const failedLogins24h = recentLogs.filter(
			(log) => log.action === "login" && log.outcome === "failure",
		).length;

		// Calculate compliance score
		const policies = await this.getAllSecurityPolicies();
		const complianceScore =
			policies.length > 0
				? Math.round((policies.filter((p) => p.enabled).length / policies.length) * 100)
				: 0;

		// Top risks analysis
		const riskCounts: Record<string, { count: number; severity: string }> = {};
		recentAlerts.forEach((alert) => {
			const key = alert.type;
			if (!riskCounts[key]) {
				riskCounts[key] = { count: 0, severity: alert.severity };
			}
			riskCounts[key].count++;
		});

		const topRisks = Object.entries(riskCounts)
			.map(([type, data]) => ({ type, count: data.count, severity: data.severity }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5);

		// Compliance status
		const complianceStatus = [
			{
				framework: "GDPR",
				status: "compliant",
				requirements: { total: 10, compliant: 9 },
			},
			{
				framework: "SOC2",
				status: "compliant",
				requirements: { total: 8, compliant: 8 },
			},
		];

		return {
			summary: {
				totalUsers: 0, // Would be fetched from user service
				activeSessions: 0, // Would be fetched from session service
				failedLogins24h,
				openAlerts: openAlerts.length,
				complianceScore,
			},
			recentAlerts: recentAlerts.slice(0, 10),
			recentAuditLogs: recentLogs.slice(0, 10),
			topRisks,
			complianceStatus,
		};
	}

	// Cleanup old data
	async cleanupExpiredData(): Promise<void> {
		await this.ensureDatabasesOpen();

		try {
			const now = new Date();
			const retentionDays = 365; // Default retention period
			const cutoffDate = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

			// Clean up old audit logs
			const oldAuditLogs: Array<AuditLog & { key: string }> = [];
			const auditIterator = this.auditDb.iterator();

			for await (const [key, value] of auditIterator) {
				if (new Date(value.timestamp) < cutoffDate) {
					oldAuditLogs.push({ ...value, key });
				}
			}
			await auditIterator.close();

			for (const log of oldAuditLogs) {
				await this.auditDb.del(log.key);
			}

			// Clean up resolved alerts older than retention period
			const oldAlerts: Array<SecurityAlert & { key: string }> = [];
			const alertIterator = this.alertsDb.iterator();

			for await (const [key, value] of alertIterator) {
				if (
					value.status === "resolved" &&
					value.resolvedAt &&
					new Date(value.resolvedAt) < cutoffDate
				) {
					oldAlerts.push({ ...value, key });
				}
			}
			await alertIterator.close();

			for (const alert of oldAlerts) {
				await this.alertsDb.del(alert.key);
			}

			if (oldAuditLogs.length > 0 || oldAlerts.length > 0) {
				console.log(
					`[SECURITY-SERVICE] Cleaned up ${oldAuditLogs.length} old audit logs and ${oldAlerts.length} old alerts`,
				);
			}
		} catch (error) {
			console.error("[SECURITY-SERVICE] Data cleanup error:", error);
		}
	}
}

// Singleton accessor
let sharedSecurityService: SecurityService | null = null;
export function getSecurityService(): SecurityService {
	if (!sharedSecurityService) {
		sharedSecurityService = new SecurityService();
	}
	return sharedSecurityService;
}
