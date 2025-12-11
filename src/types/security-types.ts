import type { PasswordPolicy, User, UserRole } from "../types.ts";

export type { User, UserRole, PasswordPolicy };

// Enhanced security types
export interface SecurityPolicy {
	id: string;
	name: string;
	description: string;
	version: string;
	enabled: boolean;
	createdAt: Date;
	updatedAt: Date;
	settings: SecurityPolicySettings;
}

export interface SecurityPolicySettings {
	passwordPolicy: PasswordPolicy;
	sessionPolicy: SessionPolicy;
	accessPolicy: AccessPolicy;
	encryptionPolicy: EncryptionPolicy;
	auditPolicy: AuditPolicy;
	compliancePolicy: CompliancePolicy;
}

export interface SessionPolicy {
	maxConcurrentSessions: number;
	sessionTimeoutMinutes: number;
	idleTimeoutMinutes: number;
	rememberMeDays: number;
	requireReauthMinutes: number;
}

export interface AccessPolicy {
	maxFailedAttempts: number;
	lockoutDurationMinutes: number;
	passwordHistoryCount: number;
	requireMfa: boolean;
	allowedIpRanges: string[];
	blockedIpRanges: string[];
	geoRestrictions: GeoRestriction[];
}

export interface GeoRestriction {
	countryCode: string;
	allowed: boolean;
	description?: string;
}

export interface EncryptionPolicy {
	dataAtRest: {
		algorithm: string;
		keyRotationDays: number;
		enabled: boolean;
	};
	dataInTransit: {
		tlsVersion: string;
		cipherSuites: string[];
		enabled: boolean;
	};
	fieldEncryption: {
		enabledFields: string[];
		algorithm: string;
		keyId: string;
	};
}

export interface AuditPolicy {
	logLevel: "debug" | "info" | "warn" | "error";
	retentionDays: number;
	logFailedAttempts: boolean;
	logDataAccess: boolean;
	logAdminActions: boolean;
	realTimeAlerts: boolean;
}

export interface CompliancePolicy {
	frameworks: ComplianceFramework[];
	dataClassification: DataClassificationPolicy;
	privacySettings: PrivacySettings;
}

export interface ComplianceFramework {
	name: string;
	version: string;
	enabled: boolean;
	requirements: ComplianceRequirement[];
	lastAuditDate?: Date;
	nextAuditDate?: Date;
	status: "compliant" | "non-compliant" | "pending" | "exempt";
}

export interface ComplianceRequirement {
	id: string;
	name: string;
	description: string;
	category: string;
	mandatory: boolean;
	implemented: boolean;
	evidence?: string;
	lastVerified?: Date;
}

export interface DataClassificationPolicy {
	levels: DataClassificationLevel[];
	defaultLevel: string;
	fieldMappings: Record<string, string>;
}

export interface DataClassificationLevel {
	name: string;
	description: string;
	encryptionRequired: boolean;
	accessLogging: boolean;
	retentionDays?: number;
	approvalRequired: boolean;
}

export interface PrivacySettings {
	dataMinimization: boolean;
	purposeLimitation: boolean;
	consentManagement: boolean;
	rightToErasure: boolean;
	dataPortability: boolean;
	anonymization: boolean;
}

// Audit logging
export interface AuditLog {
	id: string;
	timestamp: Date;
	userId?: string | undefined;
	userRole?: UserRole | undefined;
	action: string;
	resource: string;
	resourceId?: string | undefined;
	outcome: "success" | "failure" | "partial";
	ipAddress?: string | undefined;
	userAgent?: string | undefined;
	details: Record<string, unknown>;
	riskLevel: "low" | "medium" | "high" | "critical";
	category: AuditCategory;
	complianceTags: string[];
	sessionId?: string | undefined;
}

export type AuditCategory =
	| "authentication"
	| "authorization"
	| "data_access"
	| "data_modification"
	| "admin_action"
	| "security_event"
	| "compliance"
	| "system";

// Security monitoring and alerting
export interface SecurityAlert {
	id: string;
	timestamp: Date;
	type: SecurityAlertType;
	severity: "low" | "medium" | "high" | "critical";
	title: string;
	description: string;
	userId?: string | undefined;
	ipAddress?: string | undefined;
	details: Record<string, unknown>;
	status: "open" | "investigating" | "resolved" | "false_positive";
	assignedTo?: string | undefined;
	resolvedAt?: Date | undefined;
	resolutionNotes?: string | undefined;
	relatedAuditLogs: string[];
}

export type SecurityAlertType =
	| "brute_force_attack"
	| "suspicious_login"
	| "privilege_escalation"
	| "data_breach_attempt"
	| "unauthorized_access"
	| "malicious_activity"
	| "compliance_violation"
	| "system_anomaly"
	| "failed_mfa"
	| "account_lockout"
	| "unusual_behavior";

// Role-based access control enhancements
export interface EnhancedRole {
	id: string;
	name: string;
	description: string;
	permissions: Permission[];
	constraints?: RoleConstraint[];
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface RoleConstraint {
	type: "time_based" | "ip_based" | "location_based" | "device_based" | "context_based";
	conditions: Record<string, unknown>;
	description: string;
}

export interface Permission {
	id: string;
	name: string;
	resource: string;
	action: string;
	description: string;
	category: string;
	riskLevel: "low" | "medium" | "high" | "critical";
	requiresApproval: boolean;
	conditions?: PermissionCondition[];
}

export interface PermissionCondition {
	field: string;
	operator: "equals" | "not_equals" | "in" | "not_in" | "contains" | "greater_than" | "less_than";
	value: unknown;
	description: string;
}

// Data encryption
export interface EncryptionKey {
	id: string;
	name: string;
	algorithm: string;
	keySize: number;
	createdAt: Date;
	expiresAt?: Date;
	status: "active" | "deprecated" | "revoked";
	usage: string[];
	rotationSchedule?: string;
}

export interface EncryptedField {
	fieldName: string;
	keyId: string;
	algorithm: string;
	iv: string;
	encryptedData: string;
	createdAt: Date;
	updatedAt: Date;
}

// Security metrics and reporting
export interface SecurityMetrics {
	id: string;
	period: {
		start: Date;
		end: Date;
	};
	authentication: {
		totalLogins: number;
		successfulLogins: number;
		failedLogins: number;
		uniqueUsers: number;
		mfaUsage: number;
	};
	authorization: {
		totalAccessRequests: number;
		grantedRequests: number;
		deniedRequests: number;
		privilegeEscalationAttempts: number;
	};
	dataSecurity: {
		encryptedFields: number;
		dataAccessEvents: number;
		dataModificationEvents: number;
		sensitiveDataAccess: number;
	};
	compliance: {
		totalRequirements: number;
		compliantRequirements: number;
		auditEvents: number;
		violations: number;
	};
	alerts: {
		totalAlerts: number;
		criticalAlerts: number;
		resolvedAlerts: number;
		openAlerts: number;
	};
}

export interface SecurityReport {
	id: string;
	type: "compliance" | "security_posture" | "incident_summary" | "risk_assessment";
	title: string;
	description: string;
	generatedAt: Date;
	period: {
		start: Date;
		end: Date;
	};
	metrics: SecurityMetrics;
	findings: SecurityFinding[];
	recommendations: SecurityRecommendation[];
	status: "draft" | "review" | "approved" | "published";
}

export interface SecurityFinding {
	id: string;
	category: string;
	severity: "low" | "medium" | "high" | "critical";
	title: string;
	description: string;
	evidence: string[];
	impact: string;
	affectedResources: string[];
}

export interface SecurityRecommendation {
	id: string;
	category: string;
	priority: "low" | "medium" | "high" | "critical";
	title: string;
	description: string;
	steps: string[];
	estimatedEffort: string;
	targetDate?: Date;
}

// Multi-factor authentication
export interface MfaMethod {
	id: string;
	type: "totp" | "sms" | "email" | "hardware_key" | "biometric";
	name: string;
	enabled: boolean;
	configured: boolean;
	lastUsed?: Date;
	backupCodes?: string[];
}

export interface MfaChallenge {
	id: string;
	userId: string;
	method: MfaMethod["type"];
	challenge: string;
	expiresAt: Date;
	attempts: number;
	maxAttempts: number;
	status: "pending" | "completed" | "expired" | "failed";
}

// Input interfaces for security operations
export interface CreateSecurityPolicyInput {
	name: string;
	description: string;
	settings: SecurityPolicySettings;
}

export interface UpdateSecurityPolicyInput {
	id: string;
	name?: string;
	description?: string;
	settings?: Partial<SecurityPolicySettings>;
	enabled?: boolean;
}

export interface CreateSecurityAlertInput {
	type: SecurityAlertType;
	severity: SecurityAlert["severity"];
	title: string;
	description: string;
	userId?: string | undefined;
	ipAddress?: string | undefined;
	details: Record<string, unknown>;
	relatedAuditLogs?: string[] | undefined;
}

export interface CreateAuditLogInput {
	userId?: string;
	userRole?: UserRole;
	action: string;
	resource: string;
	resourceId?: string;
	outcome: AuditLog["outcome"];
	ipAddress?: string;
	userAgent?: string;
	details: Record<string, unknown>;
	riskLevel: AuditLog["riskLevel"];
	category: AuditCategory;
	complianceTags?: string[];
	sessionId?: string;
}

export interface SecuritySearchFilters {
	dateFrom?: string;
	dateTo?: string;
	userId?: string;
	action?: string;
	resource?: string;
	outcome?: AuditLog["outcome"];
	riskLevel?: AuditLog["riskLevel"];
	category?: AuditCategory;
	severities?: SecurityAlert["severity"][];
	alertTypes?: SecurityAlertType[];
	status?: SecurityAlert["status"];
}

export interface SecurityDashboardData {
	summary: {
		totalUsers: number;
		activeSessions: number;
		failedLogins24h: number;
		openAlerts: number;
		complianceScore: number;
	};
	recentAlerts: SecurityAlert[];
	recentAuditLogs: AuditLog[];
	topRisks: {
		type: string;
		count: number;
		severity: string;
	}[];
	complianceStatus: {
		framework: string;
		status: string;
		requirements: {
			total: number;
			compliant: number;
		};
	}[];
}
