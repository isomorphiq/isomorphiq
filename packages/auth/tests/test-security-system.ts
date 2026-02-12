// TODO: This test file is too complex (677 lines) and should be refactored into several modules.
// Current concerns mixed: RBAC tests, security policy tests, audit logging tests,
// security alert tests, encryption tests, compliance tests.
// 
// Proposed structure:
// - auth/tests/rbac/ - RBAC-specific tests
//   - role-management.test.ts
//   - permission-checks.test.ts
//   - constraint-validation.test.ts
// - auth/tests/security/ - Security service tests
//   - security-policies.test.ts
//   - encryption.test.ts
//   - ip-restriction.test.ts
// - auth/tests/audit/ - Audit logging tests
//   - audit-logs.test.ts
//   - audit-queries.test.ts
// - auth/tests/alerts/ - Security alert tests
//   - alert-creation.test.ts
//   - alert-management.test.ts
// - auth/tests/compliance/ - Compliance tests
//   - data-retention.test.ts
//   - gdpr-compliance.test.ts

import "../../../tests/test-utils/env-fetch.ts";
import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "../../../test-utils/expect.ts";
import {
    getSecurityService,
    getEnhancedRbacService,
    getUserManager,
} from "@isomorphiq/auth";
import type {
	CreateSecurityPolicyInput,
	CreateAuditLogInput,
	CreateSecurityAlertInput,
	SecuritySearchFilters,
} from "@isomorphiq/auth";

describe("Advanced Security and Compliance Controls", () => {
	let securityService: ReturnType<typeof getSecurityService>;
	let rbacService: ReturnType<typeof getEnhancedRbacService>;
	let userManager: ReturnType<typeof getUserManager>;

	beforeEach(async () => {
		securityService = getSecurityService();
		rbacService = getEnhancedRbacService();
		userManager = getUserManager();

		// Initialize services
		await securityService.initializeDefaultSecurityPolicy();
		await rbacService.initializeDefaultRolesAndPermissions();
	});

	afterEach(async () => {
		// Cleanup test data
		await securityService.cleanupExpiredData();
	});

	describe("Role-Based Access Control (RBAC)", () => {
		it("should initialize default enhanced roles", async () => {
			const roles = await rbacService.getAllRoles();
			
			expect(roles.length).toBeGreaterThan(0);
			expect(roles.some(r => r.name === "Enhanced Administrator")).toBe(true);
			expect(roles.some(r => r.name === "Enhanced Manager")).toBe(true);
			expect(roles.some(r => r.name === "Enhanced Developer")).toBe(true);
			expect(roles.some(r => r.name === "Enhanced Viewer")).toBe(true);
		});

		it("should create custom enhanced role with constraints", async () => {
			const roleData = {
				name: "Custom Test Role",
				description: "A test role with specific constraints",
				permissions: [
					{
						id: "custom-perm",
						name: "Custom Permission",
						resource: "test",
						action: "read",
						description: "Test permission",
						category: "Test",
						riskLevel: "low" as const,
						requiresApproval: false,
					},
				],
				constraints: [
					{
						type: "time_based" as const,
						conditions: {
							allowedHours: { start: 9, end: 17 },
							requireMfa: false,
						},
						description: "Business hours only",
					},
				],
				isActive: true,
			};

			const role = await rbacService.createRole(roleData);
			
			expect(role.id).toBeDefined();
			expect(role.name).toBe(roleData.name);
			expect(role.constraints).toHaveLength(1);
			expect(role.constraints![0].type).toBe("time_based");
		});

		it("should check permissions with role constraints", async () => {
			const userId = "test-user-123";
			const testRole = await rbacService.createRole({
				name: "Time-Restricted Role",
				description: "Role with time restrictions",
				permissions: [
					{
						id: "test-read",
						name: "Test Read",
						resource: "test",
						action: "read",
						description: "Read test resources",
						category: "Test",
						riskLevel: "low" as const,
						requiresApproval: false,
					},
				],
				constraints: [
					{
						type: "time_based" as const,
						conditions: {
							allowedHours: { start: 9, end: 17 },
						},
						description: "Business hours only",
					},
				],
				isActive: true,
			});

			await rbacService.assignRoleToUser(userId, testRole.id);

			// Test during business hours
			const businessHoursContext = {
				ipAddress: "192.168.1.100",
				timestamp: new Date(2024, 0, 1, 10, 0), // 10 AM
			};

			const businessHoursResult = await rbacService.checkPermission(
				userId,
				"test",
				"read",
				businessHoursContext
			);

			expect(businessHoursResult.granted).toBe(true);

			// Test outside business hours
			const afterHoursContext = {
				ipAddress: "192.168.1.100",
				timestamp: new Date(2024, 0, 1, 20, 0), // 8 PM
			};

			const afterHoursResult = await rbacService.checkPermission(
				userId,
				"test",
				"read",
				afterHoursContext
			);

			expect(afterHoursResult.granted).toBe(false);
			expect(afterHoursResult.reason).toBe("Access outside allowed time window");
		});

		it("should evaluate IP-based constraints", async () => {
			const userId = "test-user-456";
			const testRole = await rbacService.createRole({
				name: "IP-Restricted Role",
				description: "Role with IP restrictions",
				permissions: [
					{
						id: "test-access",
						name: "Test Access",
						resource: "test",
						action: "read",
						description: "Access test resources",
						category: "Test",
						riskLevel: "medium" as const,
						requiresApproval: false,
					},
				],
				constraints: [
					{
						type: "ip_based" as const,
						conditions: {
							allowedNetworks: ["192.168.0.0/16", "10.0.0.0/8"],
						},
						description: "Private networks only",
					},
				],
				isActive: true,
			});

			await rbacService.assignRoleToUser(userId, testRole.id);

			// Test from allowed IP
			const allowedIpContext = { ipAddress: "192.168.1.50" };
			const allowedResult = await rbacService.checkPermission(
				userId,
				"test",
				"read",
				allowedIpContext
			);

			expect(allowedResult.granted).toBe(true);

			// Test from disallowed IP
			const disallowedIpContext = { ipAddress: "8.8.8.8" };
			const disallowedResult = await rbacService.checkPermission(
				userId,
				"test",
				"read",
				disallowedIpContext
			);

			expect(disallowedResult.granted).toBe(false);
			expect(disallowedResult.reason).toBe("Access from unauthorized IP address");
		});
	});

	describe("Data Encryption", () => {
		it("should encrypt and decrypt sensitive data", () => {
			const sensitiveData = "This is sensitive information";
			const keyId = "test-key-123";

			const encryptedField = securityService.encryptSensitiveData(sensitiveData, keyId);
			
			expect(encryptedField.fieldName).toBe("sensitive_data");
			expect(encryptedField.keyId).toBe(keyId);
			expect(encryptedField.algorithm).toBe("AES-256-GCM");
			expect(encryptedField.encryptedData).not.toBe(sensitiveData);
			expect(encryptedField.iv).toBeDefined();

			const decryptedData = securityService.decryptSensitiveData(encryptedField);
			
			expect(decryptedData).toBe(sensitiveData);
		});

		it("should handle encryption errors gracefully", () => {
			const invalidEncryptedField = {
				fieldName: "test",
				keyId: "test",
				algorithm: "AES-256-GCM",
				iv: "invalid",
				encryptedData: "invalid:format",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			expect(() => {
				securityService.decryptSensitiveData(invalidEncryptedField);
			}).toThrow("Invalid encrypted data format");
		});
	});

	describe("Audit Logging", () => {
		it("should create and retrieve audit logs", async () => {
			const auditInput: CreateAuditLogInput = {
				userId: "test-user-789",
				userRole: "developer" as const,
				action: "login",
				resource: "authentication",
				outcome: "success" as const,
				ipAddress: "192.168.1.100",
				userAgent: "Test-Agent/1.0",
				details: { loginMethod: "password" },
				riskLevel: "low" as const,
				category: "authentication" as const,
				complianceTags: ["GDPR", "SOC2"],
			};

			const auditLog = await securityService.logAuditEvent(auditInput);
			
			expect(auditLog.id).toBeDefined();
			expect(auditLog.action).toBe("login");
			expect(auditLog.outcome).toBe("success");
			expect(auditLog.riskLevel).toBe("low");
			expect(auditLog.complianceTags).toEqual(["GDPR", "SOC2"]);

			// Retrieve logs
			const logs = await securityService.getAuditLogs({
				userId: "test-user-789",
				action: "login",
			});

			expect(logs).toHaveLength(1);
			expect(logs[0].id).toBe(auditLog.id);
		});

		it("should filter audit logs by multiple criteria", async () => {
			// Create multiple audit logs
			await securityService.logAuditEvent({
				userId: "user1",
				action: "login",
				resource: "auth",
				outcome: "success",
				details: {},
				riskLevel: "low",
				category: "authentication",
			});

			await securityService.logAuditEvent({
				userId: "user2",
				action: "login",
				resource: "auth",
				outcome: "failure",
				details: {},
				riskLevel: "medium",
				category: "authentication",
			});

			await securityService.logAuditEvent({
				userId: "user1",
				action: "data_access",
				resource: "tasks",
				outcome: "success",
				details: {},
				riskLevel: "high",
				category: "data_access",
			});

			// Filter by user
			const user1Logs = await securityService.getAuditLogs({
				userId: "user1",
			});
			expect(user1Logs).toHaveLength(2);

			// Filter by risk level
			const highRiskLogs = await securityService.getAuditLogs({
				riskLevel: "high",
			});
			expect(highRiskLogs).toHaveLength(1);

			// Filter by category
			const authLogs = await securityService.getAuditLogs({
				category: "authentication",
			});
			expect(authLogs).toHaveLength(2);
		});
	});

	describe("Security Alerts", () => {
		it("should create and manage security alerts", async () => {
			const alertInput: CreateSecurityAlertInput = {
				type: "suspicious_login" as const,
				severity: "high" as const,
				title: "Suspicious Login Detected",
				description: "Multiple failed login attempts from unusual location",
				userId: "test-user-123",
				ipAddress: "203.0.113.42",
				details: {
					attempts: 5,
					location: "Unknown",
					timeWindow: "10 minutes",
				},
			};

			const alert = await securityService.createSecurityAlert(alertInput);
			
			expect(alert.id).toBeDefined();
			expect(alert.type).toBe("suspicious_login");
			expect(alert.severity).toBe("high");
			expect(alert.status).toBe("open");

			// Update alert status
			const updatedAlert = await securityService.updateSecurityAlertStatus(
				alert.id,
				"resolved",
				"False positive - user was traveling"
			);

			expect(updatedAlert.status).toBe("resolved");
			expect(updatedAlert.resolutionNotes).toBe("False positive - user was traveling");
			expect(updatedAlert.resolvedAt).toBeDefined();
		});

		it("should detect brute force attacks automatically", async () => {
			const userId = "target-user";
			const ipAddress = "203.0.113.42";

			// Simulate multiple failed logins
			for (let i = 0; i < 5; i++) {
				await securityService.logAuditEvent({
					userId,
					action: "login",
					resource: "authentication",
					outcome: "failure",
					ipAddress,
					details: { attempt: i + 1 },
					riskLevel: "medium",
					category: "authentication",
				});
			}

			// Check if alert was created
			const alerts = await securityService.getSecurityAlerts({
				userId,
				type: "brute_force_attack",
			});

			expect(alerts.length).toBeGreaterThan(0);
			expect(alerts[0].type).toBe("brute_force_attack");
			expect(alerts[0].severity).toBe("high");
		});
	});

	describe("Security Policies", () => {
		it("should create and update security policies", async () => {
			const policyInput: CreateSecurityPolicyInput = {
				name: "Test Security Policy",
				description: "A comprehensive security policy for testing",
				settings: {
					passwordPolicy: {
						minLength: 14,
						requireUppercase: true,
						requireLowercase: true,
						requireNumbers: true,
						requireSpecialChars: true,
						preventReuse: 12,
						maxAge: 120,
					},
					sessionPolicy: {
						maxConcurrentSessions: 2,
						sessionTimeoutMinutes: 20,
						idleTimeoutMinutes: 10,
						rememberMeDays: 30,
						requireReauthMinutes: 30,
					},
					accessPolicy: {
						maxFailedAttempts: 3,
						lockoutDurationMinutes: 15,
						passwordHistoryCount: 8,
						requireMfa: true,
						allowedIpRanges: ["10.0.0.0/8"],
						blockedIpRanges: [],
						geoRestrictions: [],
					},
					encryptionPolicy: {
						dataAtRest: {
							algorithm: "AES-256-GCM",
							keyRotationDays: 60,
							enabled: true,
						},
						dataInTransit: {
							tlsVersion: "1.3",
							cipherSuites: ["TLS_AES_256_GCM_SHA384"],
							enabled: true,
						},
						fieldEncryption: {
							enabledFields: ["email", "phone", "ssn"],
							algorithm: "AES-256-GCM",
							keyId: "policy-key",
						},
					},
					auditPolicy: {
						logLevel: "info",
						retentionDays: 730,
						logFailedAttempts: true,
						logDataAccess: true,
						logAdminActions: true,
						realTimeAlerts: true,
					},
					compliancePolicy: {
						frameworks: [
							{
								name: "HIPAA",
								version: "2013",
								enabled: true,
								requirements: [
									{
										id: "HIPAA-1",
										name: "Access Control",
										description: "Implement proper access controls",
										category: "Access Control",
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
									name: "phi",
									description: "Protected Health Information",
									encryptionRequired: true,
									accessLogging: true,
									retentionDays: 2555,
									approvalRequired: true,
								},
							],
							defaultLevel: "internal",
							fieldMappings: {
								medicalRecord: "phi",
								patientInfo: "phi",
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

			const policy = await securityService.createSecurityPolicy(policyInput);
			
			expect(policy.id).toBeDefined();
			expect(policy.name).toBe("Test Security Policy");
			expect(policy.settings.passwordPolicy.minLength).toBe(14);
			expect(policy.enabled).toBe(true);

			// Update policy
			const updatedPolicy = await securityService.updateSecurityPolicy({
				id: policy.id,
				name: "Updated Test Policy",
				enabled: false,
			});

			expect(updatedPolicy.name).toBe("Updated Test Policy");
			expect(updatedPolicy.enabled).toBe(false);
		});
	});

	describe("Security Metrics and Reporting", () => {
		it("should generate security metrics", async () => {
			const startDate = new Date(2024, 0, 1); // Jan 1, 2024
			const endDate = new Date(2024, 0, 31); // Jan 31, 2024

			// Create some test data
			await securityService.logAuditEvent({
				action: "login",
				resource: "auth",
				outcome: "success",
				details: {},
				riskLevel: "low",
				category: "authentication",
			});

			await securityService.logAuditEvent({
				action: "login",
				resource: "auth",
				outcome: "failure",
				details: {},
				riskLevel: "medium",
				category: "authentication",
			});

			const metrics = await securityService.generateSecurityMetrics(startDate, endDate);
			
			expect(metrics.id).toBeDefined();
			expect(metrics.period.start).toBe(startDate);
			expect(metrics.period.end).toBe(endDate);
			expect(metrics.authentication.totalLogins).toBe(2);
			expect(metrics.authentication.successfulLogins).toBe(1);
			expect(metrics.authentication.failedLogins).toBe(1);
		});

		it("should generate security dashboard data", async () => {
			const dashboardData = await securityService.getSecurityDashboardData();
			
			expect(dashboardData.summary).toBeDefined();
			expect(dashboardData.summary.complianceScore).toBeGreaterThanOrEqual(0);
			expect(dashboardData.summary.complianceScore).toBeLessThanOrEqual(100);
			expect(dashboardData.recentAlerts).toBeDefined();
			expect(dashboardData.recentAuditLogs).toBeDefined();
			expect(dashboardData.topRisks).toBeDefined();
			expect(dashboardData.complianceStatus).toBeDefined();
		});

		it("should generate security reports", async () => {
			const startDate = new Date(2024, 0, 1);
			const endDate = new Date(2024, 0, 31);

			const report = await securityService.generateSecurityReport(
				"security_posture",
				startDate,
				endDate
			);

			expect(report.id).toBeDefined();
			expect(report.type).toBe("security_posture");
			expect(report.generatedAt).toBeDefined();
			expect(report.metrics).toBeDefined();
			expect(report.findings).toBeDefined();
			expect(report.recommendations).toBeDefined();
			expect(report.status).toBe("draft");
		});
	});

	describe("Compliance Framework", () => {
		it("should support multiple compliance frameworks", async () => {
			const policies = await securityService.getAllSecurityPolicies();
			const defaultPolicy = policies.find(p => p.id === "default-security-policy");
			
			expect(defaultPolicy).toBeDefined();
			expect(defaultPolicy!.settings.compliancePolicy.frameworks).toHaveLength(2);
			
			const gdprFramework = defaultPolicy!.settings.compliancePolicy.frameworks.find(
				f => f.name === "GDPR"
			);
			expect(gdprFramework).toBeDefined();
			expect(gdprFramework!.enabled).toBe(true);
			expect(gdprFramework!.status).toBe("compliant");

			const soc2Framework = defaultPolicy!.settings.compliancePolicy.frameworks.find(
				f => f.name === "SOC2"
			);
			expect(soc2Framework).toBeDefined();
			expect(soc2Framework!.enabled).toBe(true);
			expect(soc2Framework!.status).toBe("compliant");
		});

		it("should implement data classification levels", async () => {
			const policies = await securityService.getAllSecurityPolicies();
			const defaultPolicy = policies.find(p => p.id === "default-security-policy");
			
			expect(defaultPolicy).toBeDefined();
			const classification = defaultPolicy!.settings.compliancePolicy.dataClassification;
			
			expect(classification.levels).toHaveLength(4);
			expect(classification.levels.some(l => l.name === "public")).toBe(true);
			expect(classification.levels.some(l => l.name === "confidential")).toBe(true);
			expect(classification.levels.some(l => l.name === "restricted")).toBe(true);
			
			expect(classification.defaultLevel).toBe("internal");
			expect(classification.fieldMappings.email).toBe("confidential");
			expect(classification.fieldMappings.ssn).toBe("restricted");
		});
	});

	describe("Integration with Existing System", () => {
		it("should integrate with user management", async () => {
			// Create a test user
			const testUser = await userManager.createUser({
				username: "security-test-user",
				email: "security-test@example.com",
				password: "SecurePassword123!",
				role: "developer",
			});

			// Assign enhanced role
			const enhancedRoles = await rbacService.getAllRoles();
			const developerRole = enhancedRoles.find(r => r.name === "Enhanced Developer");
			expect(developerRole).toBeDefined();

			await rbacService.assignRoleToUser(testUser.id, developerRole!.id);

			// Check effective permissions
			const effectivePermissions = await rbacService.getUserEffectivePermissions(testUser.id);
			
			expect(effectivePermissions.roles).toHaveLength(1);
			expect(effectivePermissions.permissions.length).toBeGreaterThan(0);
			expect(effectivePermissions.constraints).toBeDefined();
		});

		it("should log security events for user actions", async () => {
			const testUser = await userManager.createUser({
				username: "audit-test-user",
				email: "audit-test@example.com",
				password: "SecurePassword123!",
				role: "manager",
			});

			// Simulate user action that should be logged
			await securityService.logAuditEvent({
				userId: testUser.id,
				userRole: testUser.role,
				action: "user_update",
				resource: "users",
				outcome: "success",
				details: { updatedField: "email" },
				riskLevel: "medium",
				category: "admin_action",
				complianceTags: ["GDPR"],
			});

			// Verify log was created
			const logs = await securityService.getAuditLogs({
				userId: testUser.id,
				action: "user_update",
			});

			expect(logs).toHaveLength(1);
			expect(logs[0].userId).toBe(testUser.id);
			expect(logs[0].action).toBe("user_update");
			expect(logs[0].category).toBe("admin_action");
		});
	});
});
