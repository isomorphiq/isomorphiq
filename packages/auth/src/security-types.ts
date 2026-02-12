import { z } from "zod";
import { impl, method, struct } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import { IdentifiableTrait, PasswordPolicySchema, UserRoleSchema } from "./types.ts";

const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
const AuditOutcomeSchema = z.enum(["success", "failure", "partial"]);
export const AuditCategorySchema = z.enum([
    "authentication",
    "authorization",
    "data_access",
    "data_modification",
    "admin_action",
    "security_event",
    "compliance",
    "system",
]);
export type AuditCategory = z.output<typeof AuditCategorySchema>;
const SecurityAlertStatusSchema = z.enum(["open", "investigating", "resolved", "false_positive"]);
export const SecurityAlertTypeSchema = z.enum([
    "brute_force_attack",
    "suspicious_login",
    "privilege_escalation",
    "data_breach_attempt",
    "unauthorized_access",
    "malicious_activity",
    "compliance_violation",
    "system_anomaly",
    "failed_mfa",
    "account_lockout",
    "unusual_behavior",
]);
export type SecurityAlertType = z.output<typeof SecurityAlertTypeSchema>;
const ComplianceFrameworkStatusSchema = z.enum([
    "compliant",
    "non-compliant",
    "pending",
    "exempt",
]);
const RoleConstraintTypeSchema = z.enum([
    "time_based",
    "ip_based",
    "location_based",
    "device_based",
    "context_based",
]);
const PermissionConditionOperatorSchema = z.enum([
    "equals",
    "not_equals",
    "in",
    "not_in",
    "contains",
    "greater_than",
    "less_than",
]);
const SecurityReportStatusSchema = z.enum(["draft", "review", "approved", "published"]);
const SecurityReportTypeSchema = z.enum([
    "compliance",
    "security_posture",
    "incident_summary",
    "risk_assessment",
]);
const MfaMethodTypeSchema = z.enum(["totp", "sms", "email", "hardware_key", "biometric"]);
const MfaChallengeStatusSchema = z.enum(["pending", "completed", "expired", "failed"]);

export const GeoRestrictionSchema = z.object({
    countryCode: z.string(),
    allowed: z.boolean(),
    description: z.string().optional(),
});

export const GeoRestrictionStruct = struct.name("GeoRestriction")<z.output<typeof GeoRestrictionSchema>, z.input<typeof GeoRestrictionSchema>>(GeoRestrictionSchema);
export type GeoRestriction = StructSelf<typeof GeoRestrictionStruct>;

export const SessionPolicySchema = z.object({
    maxConcurrentSessions: z.number(),
    sessionTimeoutMinutes: z.number(),
    idleTimeoutMinutes: z.number(),
    rememberMeDays: z.number(),
    requireReauthMinutes: z.number(),
});

export const SessionPolicyStruct = struct.name("SessionPolicy")<z.output<typeof SessionPolicySchema>, z.input<typeof SessionPolicySchema>>(SessionPolicySchema);
export type SessionPolicy = StructSelf<typeof SessionPolicyStruct>;

export const AccessPolicySchema = z.object({
    maxFailedAttempts: z.number(),
    lockoutDurationMinutes: z.number(),
    passwordHistoryCount: z.number(),
    requireMfa: z.boolean(),
    allowedIpRanges: z.array(z.string()),
    blockedIpRanges: z.array(z.string()),
    geoRestrictions: z.array(GeoRestrictionSchema),
});

export const AccessPolicyStruct = struct.name("AccessPolicy")<z.output<typeof AccessPolicySchema>, z.input<typeof AccessPolicySchema>>(AccessPolicySchema);
export type AccessPolicy = StructSelf<typeof AccessPolicyStruct>;

export const EncryptionPolicySchema = z.object({
    dataAtRest: z.object({
        algorithm: z.string(),
        keyRotationDays: z.number(),
        enabled: z.boolean(),
    }),
    dataInTransit: z.object({
        tlsVersion: z.string(),
        cipherSuites: z.array(z.string()),
        enabled: z.boolean(),
    }),
    fieldEncryption: z.object({
        enabledFields: z.array(z.string()),
        algorithm: z.string(),
        keyId: z.string(),
    }),
});

export const EncryptionPolicyStruct = struct.name("EncryptionPolicy")<z.output<typeof EncryptionPolicySchema>, z.input<typeof EncryptionPolicySchema>>(EncryptionPolicySchema);
export type EncryptionPolicy = StructSelf<typeof EncryptionPolicyStruct>;

export const AuditPolicySchema = z.object({
    logLevel: z.enum(["debug", "info", "warn", "error"]),
    retentionDays: z.number(),
    logFailedAttempts: z.boolean(),
    logDataAccess: z.boolean(),
    logAdminActions: z.boolean(),
    realTimeAlerts: z.boolean(),
});

export const AuditPolicyStruct = struct.name("AuditPolicy")<z.output<typeof AuditPolicySchema>, z.input<typeof AuditPolicySchema>>(AuditPolicySchema);
export type AuditPolicy = StructSelf<typeof AuditPolicyStruct>;

export const ComplianceRequirementSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    mandatory: z.boolean(),
    implemented: z.boolean(),
    evidence: z.string().optional(),
    lastVerified: z.date().optional(),
});

export const ComplianceRequirementStruct = struct.name("ComplianceRequirement")<z.output<typeof ComplianceRequirementSchema>, z.input<typeof ComplianceRequirementSchema>>(ComplianceRequirementSchema);
export type ComplianceRequirement = StructSelf<typeof ComplianceRequirementStruct>;

export const ComplianceFrameworkSchema = z.object({
    name: z.string(),
    version: z.string(),
    enabled: z.boolean(),
    requirements: z.array(ComplianceRequirementSchema),
    lastAuditDate: z.date().optional(),
    nextAuditDate: z.date().optional(),
    status: ComplianceFrameworkStatusSchema,
});

export const ComplianceFrameworkStruct = struct.name("ComplianceFramework")<z.output<typeof ComplianceFrameworkSchema>, z.input<typeof ComplianceFrameworkSchema>>(ComplianceFrameworkSchema);
export type ComplianceFramework = StructSelf<typeof ComplianceFrameworkStruct>;

export const DataClassificationLevelSchema = z.object({
    name: z.string(),
    description: z.string(),
    encryptionRequired: z.boolean(),
    accessLogging: z.boolean(),
    retentionDays: z.number().optional(),
    approvalRequired: z.boolean(),
});

export const DataClassificationLevelStruct = struct.name("DataClassificationLevel")<z.output<typeof DataClassificationLevelSchema>, z.input<typeof DataClassificationLevelSchema>>(DataClassificationLevelSchema);
export type DataClassificationLevel = StructSelf<typeof DataClassificationLevelStruct>;

export const DataClassificationPolicySchema = z.object({
    levels: z.array(DataClassificationLevelSchema),
    defaultLevel: z.string(),
    fieldMappings: z.record(z.string()),
});

export const DataClassificationPolicyStruct = struct.name("DataClassificationPolicy")<z.output<typeof DataClassificationPolicySchema>, z.input<typeof DataClassificationPolicySchema>>(DataClassificationPolicySchema);
export type DataClassificationPolicy = StructSelf<typeof DataClassificationPolicyStruct>;

export const PrivacySettingsSchema = z.object({
    dataMinimization: z.boolean(),
    purposeLimitation: z.boolean(),
    consentManagement: z.boolean(),
    rightToErasure: z.boolean(),
    dataPortability: z.boolean(),
    anonymization: z.boolean(),
});

export const PrivacySettingsStruct = struct.name("PrivacySettings")<z.output<typeof PrivacySettingsSchema>, z.input<typeof PrivacySettingsSchema>>(PrivacySettingsSchema);
export type PrivacySettings = StructSelf<typeof PrivacySettingsStruct>;

export const CompliancePolicySchema = z.object({
    frameworks: z.array(ComplianceFrameworkSchema),
    dataClassification: DataClassificationPolicySchema,
    privacySettings: PrivacySettingsSchema,
});

export const CompliancePolicyStruct = struct.name("CompliancePolicy")<z.output<typeof CompliancePolicySchema>, z.input<typeof CompliancePolicySchema>>(CompliancePolicySchema);
export type CompliancePolicy = StructSelf<typeof CompliancePolicyStruct>;

export const SecurityPolicySettingsSchema = z.object({
    passwordPolicy: PasswordPolicySchema,
    sessionPolicy: SessionPolicySchema,
    accessPolicy: AccessPolicySchema,
    encryptionPolicy: EncryptionPolicySchema,
    auditPolicy: AuditPolicySchema,
    compliancePolicy: CompliancePolicySchema,
});

export const SecurityPolicySettingsStruct = struct.name("SecurityPolicySettings")<z.output<typeof SecurityPolicySettingsSchema>, z.input<typeof SecurityPolicySettingsSchema>>(SecurityPolicySettingsSchema);
export type SecurityPolicySettings = StructSelf<typeof SecurityPolicySettingsStruct>;

export const SecurityPolicySchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    version: z.string(),
    enabled: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
    settings: SecurityPolicySettingsSchema,
});

export const SecurityPolicyStruct = struct.name("SecurityPolicy")<z.output<typeof SecurityPolicySchema>, z.input<typeof SecurityPolicySchema>>(SecurityPolicySchema);
export type SecurityPolicy = StructSelf<typeof SecurityPolicyStruct>;

export const AuditLogSchema = z.object({
    id: z.string(),
    timestamp: z.date(),
    userId: z.string().optional(),
    userRole: UserRoleSchema.optional(),
    action: z.string(),
    resource: z.string(),
    resourceId: z.string().optional(),
    outcome: AuditOutcomeSchema,
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    details: z.record(z.unknown()),
    riskLevel: SeveritySchema,
    category: AuditCategorySchema,
    complianceTags: z.array(z.string()),
    sessionId: z.string().optional(),
});

export const AuditLogStruct = struct.name("AuditLog")<z.output<typeof AuditLogSchema>, z.input<typeof AuditLogSchema>>(AuditLogSchema);
export type AuditLog = StructSelf<typeof AuditLogStruct>;

export const SecurityAlertSchema = z.object({
    id: z.string(),
    timestamp: z.date(),
    type: SecurityAlertTypeSchema,
    severity: SeveritySchema,
    title: z.string(),
    description: z.string(),
    userId: z.string().optional(),
    ipAddress: z.string().optional(),
    details: z.record(z.unknown()),
    status: SecurityAlertStatusSchema,
    assignedTo: z.string().optional(),
    resolvedAt: z.date().optional(),
    resolutionNotes: z.string().optional(),
    relatedAuditLogs: z.array(z.string()),
});

export const SecurityAlertStruct = struct.name("SecurityAlert")<z.output<typeof SecurityAlertSchema>, z.input<typeof SecurityAlertSchema>>(SecurityAlertSchema);
export type SecurityAlert = StructSelf<typeof SecurityAlertStruct>;

export const RoleConstraintSchema = z.object({
    type: RoleConstraintTypeSchema,
    conditions: z.record(z.unknown()),
    description: z.string(),
});

export const RoleConstraintStruct = struct.name("RoleConstraint")<z.output<typeof RoleConstraintSchema>, z.input<typeof RoleConstraintSchema>>(RoleConstraintSchema);
export type RoleConstraint = StructSelf<typeof RoleConstraintStruct>;

export const PermissionConditionSchema = z.object({
    field: z.string(),
    operator: PermissionConditionOperatorSchema,
    value: z.unknown(),
    description: z.string(),
});

export const PermissionConditionStruct = struct.name("PermissionCondition")<z.output<typeof PermissionConditionSchema>, z.input<typeof PermissionConditionSchema>>(PermissionConditionSchema);
export type PermissionCondition = StructSelf<typeof PermissionConditionStruct>;

export const PermissionSchema = z.object({
    id: z.string(),
    name: z.string(),
    resource: z.string(),
    action: z.string(),
    description: z.string(),
    category: z.string(),
    riskLevel: SeveritySchema,
    requiresApproval: z.boolean(),
    conditions: z.array(PermissionConditionSchema).optional(),
});

export const PermissionStruct = struct.name("Permission")<z.output<typeof PermissionSchema>, z.input<typeof PermissionSchema>>(PermissionSchema);
export type Permission = StructSelf<typeof PermissionStruct>;

export const EnhancedRoleSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    permissions: z.array(PermissionSchema),
    constraints: z.array(RoleConstraintSchema).optional(),
    isActive: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const EnhancedRoleStruct = struct.name("EnhancedRole")<z.output<typeof EnhancedRoleSchema>, z.input<typeof EnhancedRoleSchema>>(EnhancedRoleSchema);
export type EnhancedRole = StructSelf<typeof EnhancedRoleStruct>;

export const RolePermissionsSchema = z.object({
    admin: z.array(PermissionSchema),
    manager: z.array(PermissionSchema),
    developer: z.array(PermissionSchema),
    viewer: z.array(PermissionSchema),
});

export type RolePermissions = {
    [Key in z.output<typeof UserRoleSchema>]: Permission[];
};

export const UserPermissionsSchema = z.object({
    userId: z.string(),
    role: UserRoleSchema,
    permissions: z.array(PermissionSchema),
    customPermissions: z.array(PermissionSchema).optional(),
});

export const UserPermissionsStruct = struct.name("UserPermissions")<z.output<typeof UserPermissionsSchema>, z.input<typeof UserPermissionsSchema>>(UserPermissionsSchema);
export type UserPermissions = StructSelf<typeof UserPermissionsStruct>;

export const EncryptionKeySchema = z.object({
    id: z.string(),
    name: z.string(),
    algorithm: z.string(),
    keySize: z.number(),
    createdAt: z.date(),
    expiresAt: z.date().optional(),
    status: z.enum(["active", "deprecated", "revoked"]),
    usage: z.array(z.string()),
    rotationSchedule: z.string().optional(),
});

export const EncryptionKeyStruct = struct.name("EncryptionKey")<z.output<typeof EncryptionKeySchema>, z.input<typeof EncryptionKeySchema>>(EncryptionKeySchema);
export type EncryptionKey = StructSelf<typeof EncryptionKeyStruct>;

export const EncryptedFieldSchema = z.object({
    fieldName: z.string(),
    keyId: z.string(),
    algorithm: z.string(),
    iv: z.string(),
    encryptedData: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const EncryptedFieldStruct = struct.name("EncryptedField")<z.output<typeof EncryptedFieldSchema>, z.input<typeof EncryptedFieldSchema>>(EncryptedFieldSchema);
export type EncryptedField = StructSelf<typeof EncryptedFieldStruct>;

export const SecurityMetricsSchema = z.object({
    id: z.string(),
    period: z.object({
        start: z.date(),
        end: z.date(),
    }),
    authentication: z.object({
        totalLogins: z.number(),
        successfulLogins: z.number(),
        failedLogins: z.number(),
        uniqueUsers: z.number(),
        mfaUsage: z.number(),
    }),
    authorization: z.object({
        totalAccessRequests: z.number(),
        grantedRequests: z.number(),
        deniedRequests: z.number(),
        privilegeEscalationAttempts: z.number(),
    }),
    dataSecurity: z.object({
        encryptedFields: z.number(),
        dataAccessEvents: z.number(),
        dataModificationEvents: z.number(),
        sensitiveDataAccess: z.number(),
    }),
    compliance: z.object({
        totalRequirements: z.number(),
        compliantRequirements: z.number(),
        auditEvents: z.number(),
        violations: z.number(),
    }),
    alerts: z.object({
        totalAlerts: z.number(),
        criticalAlerts: z.number(),
        resolvedAlerts: z.number(),
        openAlerts: z.number(),
    }),
});

export const SecurityMetricsStruct = struct.name("SecurityMetrics")<z.output<typeof SecurityMetricsSchema>, z.input<typeof SecurityMetricsSchema>>(SecurityMetricsSchema);
export type SecurityMetrics = StructSelf<typeof SecurityMetricsStruct>;

export const SecurityFindingSchema = z.object({
    id: z.string(),
    category: z.string(),
    severity: SeveritySchema,
    title: z.string(),
    description: z.string(),
    evidence: z.array(z.string()),
    impact: z.string(),
    affectedResources: z.array(z.string()),
});

export const SecurityFindingStruct = struct.name("SecurityFinding")<z.output<typeof SecurityFindingSchema>, z.input<typeof SecurityFindingSchema>>(SecurityFindingSchema);
export type SecurityFinding = StructSelf<typeof SecurityFindingStruct>;

export const SecurityRecommendationSchema = z.object({
    id: z.string(),
    category: z.string(),
    priority: SeveritySchema,
    title: z.string(),
    description: z.string(),
    steps: z.array(z.string()),
    estimatedEffort: z.string(),
    targetDate: z.date().optional(),
});

export const SecurityRecommendationStruct = struct.name("SecurityRecommendation")<z.output<typeof SecurityRecommendationSchema>, z.input<typeof SecurityRecommendationSchema>>(SecurityRecommendationSchema);
export type SecurityRecommendation = StructSelf<typeof SecurityRecommendationStruct>;

export const SecurityReportSchema = z.object({
    id: z.string(),
    type: SecurityReportTypeSchema,
    title: z.string(),
    description: z.string(),
    generatedAt: z.date(),
    period: z.object({
        start: z.date(),
        end: z.date(),
    }),
    metrics: SecurityMetricsSchema,
    findings: z.array(SecurityFindingSchema),
    recommendations: z.array(SecurityRecommendationSchema),
    status: SecurityReportStatusSchema,
});

export const SecurityReportStruct = struct.name("SecurityReport")<z.output<typeof SecurityReportSchema>, z.input<typeof SecurityReportSchema>>(SecurityReportSchema);
export type SecurityReport = StructSelf<typeof SecurityReportStruct>;

export const MfaMethodSchema = z.object({
    id: z.string(),
    type: MfaMethodTypeSchema,
    name: z.string(),
    enabled: z.boolean(),
    configured: z.boolean(),
    lastUsed: z.date().optional(),
    backupCodes: z.array(z.string()).optional(),
});

export const MfaMethodStruct = struct.name("MfaMethod")<z.output<typeof MfaMethodSchema>, z.input<typeof MfaMethodSchema>>(MfaMethodSchema);
export type MfaMethod = StructSelf<typeof MfaMethodStruct>;

export const MfaChallengeSchema = z.object({
    id: z.string(),
    userId: z.string(),
    method: MfaMethodTypeSchema,
    challenge: z.string(),
    expiresAt: z.date(),
    attempts: z.number(),
    maxAttempts: z.number(),
    status: MfaChallengeStatusSchema,
});

export const MfaChallengeStruct = struct.name("MfaChallenge")<z.output<typeof MfaChallengeSchema>, z.input<typeof MfaChallengeSchema>>(MfaChallengeSchema);
export type MfaChallenge = StructSelf<typeof MfaChallengeStruct>;

export const CreateSecurityPolicyInputSchema = z.object({
    name: z.string(),
    description: z.string(),
    settings: SecurityPolicySettingsSchema,
});

export const CreateSecurityPolicyInputStruct = struct.name("CreateSecurityPolicyInput")<z.output<typeof CreateSecurityPolicyInputSchema>, z.input<typeof CreateSecurityPolicyInputSchema>>(CreateSecurityPolicyInputSchema);
export type CreateSecurityPolicyInput = StructSelf<typeof CreateSecurityPolicyInputStruct>;

export const UpdateSecurityPolicyInputSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    settings: SecurityPolicySettingsSchema.partial().optional(),
    enabled: z.boolean().optional(),
});

export const UpdateSecurityPolicyInputStruct = struct.name("UpdateSecurityPolicyInput")<z.output<typeof UpdateSecurityPolicyInputSchema>, z.input<typeof UpdateSecurityPolicyInputSchema>>(UpdateSecurityPolicyInputSchema);
export type UpdateSecurityPolicyInput = StructSelf<typeof UpdateSecurityPolicyInputStruct>;

export const CreateSecurityAlertInputSchema = z.object({
    type: SecurityAlertTypeSchema,
    severity: SeveritySchema,
    title: z.string(),
    description: z.string(),
    userId: z.string().optional(),
    ipAddress: z.string().optional(),
    details: z.record(z.unknown()),
    relatedAuditLogs: z.array(z.string()).optional(),
});

export const CreateSecurityAlertInputStruct = struct.name("CreateSecurityAlertInput")<z.output<typeof CreateSecurityAlertInputSchema>, z.input<typeof CreateSecurityAlertInputSchema>>(CreateSecurityAlertInputSchema);
export type CreateSecurityAlertInput = StructSelf<typeof CreateSecurityAlertInputStruct>;

export const CreateAuditLogInputSchema = z.object({
    userId: z.string().optional(),
    userRole: UserRoleSchema.optional(),
    action: z.string(),
    resource: z.string(),
    resourceId: z.string().optional(),
    outcome: AuditOutcomeSchema,
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    details: z.record(z.unknown()),
    riskLevel: SeveritySchema,
    category: AuditCategorySchema,
    complianceTags: z.array(z.string()).optional(),
    sessionId: z.string().optional(),
});

export const CreateAuditLogInputStruct = struct.name("CreateAuditLogInput")<z.output<typeof CreateAuditLogInputSchema>, z.input<typeof CreateAuditLogInputSchema>>(CreateAuditLogInputSchema);
export type CreateAuditLogInput = StructSelf<typeof CreateAuditLogInputStruct>;

export const SecuritySearchFiltersSchema = z.object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    userId: z.string().optional(),
    action: z.string().optional(),
    resource: z.string().optional(),
    outcome: AuditOutcomeSchema.optional(),
    riskLevel: SeveritySchema.optional(),
    category: AuditCategorySchema.optional(),
    severities: z.array(SeveritySchema).optional(),
    alertTypes: z.array(SecurityAlertTypeSchema).optional(),
    status: SecurityAlertStatusSchema.optional(),
});

export const SecuritySearchFiltersStruct = struct.name("SecuritySearchFilters")<z.output<typeof SecuritySearchFiltersSchema>, z.input<typeof SecuritySearchFiltersSchema>>(SecuritySearchFiltersSchema);
export type SecuritySearchFilters = StructSelf<typeof SecuritySearchFiltersStruct>;

export const SecurityDashboardDataSchema = z.object({
    summary: z.object({
        totalUsers: z.number(),
        activeSessions: z.number(),
        failedLogins24h: z.number(),
        openAlerts: z.number(),
        complianceScore: z.number(),
    }),
    recentAlerts: z.array(SecurityAlertSchema),
    recentAuditLogs: z.array(AuditLogSchema),
    topRisks: z.array(
        z.object({
            type: z.string(),
            count: z.number(),
            severity: z.string(),
        }),
    ),
    complianceStatus: z.array(
        z.object({
            framework: z.string(),
            status: z.string(),
            requirements: z.object({
                total: z.number(),
                compliant: z.number(),
            }),
        }),
    ),
});

export const SecurityDashboardDataStruct = struct.name("SecurityDashboardData")<z.output<typeof SecurityDashboardDataSchema>, z.input<typeof SecurityDashboardDataSchema>>(SecurityDashboardDataSchema);
export type SecurityDashboardData = StructSelf<typeof SecurityDashboardDataStruct>;

impl(IdentifiableTrait).for(SecurityPolicyStruct, {
    id: method((self: SecurityPolicy) => self.id),
});

impl(IdentifiableTrait).for(AuditLogStruct, {
    id: method((self: AuditLog) => self.id),
});

impl(IdentifiableTrait).for(SecurityAlertStruct, {
    id: method((self: SecurityAlert) => self.id),
});

impl(IdentifiableTrait).for(EnhancedRoleStruct, {
    id: method((self: EnhancedRole) => self.id),
});

impl(IdentifiableTrait).for(PermissionStruct, {
    id: method((self: Permission) => self.id),
});

impl(IdentifiableTrait).for(EncryptionKeyStruct, {
    id: method((self: EncryptionKey) => self.id),
});

impl(IdentifiableTrait).for(SecurityMetricsStruct, {
    id: method((self: SecurityMetrics) => self.id),
});

impl(IdentifiableTrait).for(SecurityReportStruct, {
    id: method((self: SecurityReport) => self.id),
});

impl(IdentifiableTrait).for(SecurityFindingStruct, {
    id: method((self: SecurityFinding) => self.id),
});

impl(IdentifiableTrait).for(SecurityRecommendationStruct, {
    id: method((self: SecurityRecommendation) => self.id),
});

impl(IdentifiableTrait).for(MfaMethodStruct, {
    id: method((self: MfaMethod) => self.id),
});

impl(IdentifiableTrait).for(MfaChallengeStruct, {
    id: method((self: MfaChallenge) => self.id),
});
