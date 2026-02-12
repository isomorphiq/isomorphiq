import type React from "react";
interface SecurityDashboardProps {
    dashboardData: {
        summary: {
            totalUsers: number;
            activeSessions: number;
            failedLogins24h: number;
            openAlerts: number;
            complianceScore: number;
        };
        topRisks: Array<{
            type: string;
            count: number;
            severity: string;
        }>;
        complianceStatus: Array<{
            framework: string;
            requirements: {
                compliant: number;
                total: number;
            };
            status: string;
        }>;
        recentAlerts: Array<{
            id: string;
            type: string;
            severity: string;
            title: string;
            description: string;
            timestamp: string;
            status: string;
        }>;
        recentAuditLogs: Array<{
            id: string;
            userId: string;
            action: string;
            resource: string;
            outcome: string;
            timestamp: string;
        }>;
    };
    onCreateAlert?: (alert: CreateSecurityAlertInput) => void;
}
interface CreateSecurityAlertInput {
    type: string;
    severity: "low" | "medium" | "high" | "critical";
    title: string;
    description: string;
    details: Record<string, unknown>;
}
export declare const SecurityDashboard: React.FC<SecurityDashboardProps>;
export {};
