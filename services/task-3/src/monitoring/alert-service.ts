import type { MixedOperationMetrics } from "../types.ts";
import type { AlertRule, PerformanceAlert } from "./types.ts";

const getAlertValue = (ruleName: string, metrics: Partial<MixedOperationMetrics>): number => {
    switch (ruleName) {
        case "Low Success Rate":
        case "Critical Success Rate":
            return metrics.successRate || 1;
        case "High Average Duration":
        case "Critical Average Duration":
            return metrics.averageDuration || 0;
        case "Low Throughput":
            return metrics.operationsPerSecond || 0;
        case "High Contention":
        case "Critical Contention":
            return metrics.resourceUtilization?.lockContentionRate || 0;
        default:
            return 0;
    }
};

const getAlertType = (ruleName: string): PerformanceAlert["type"] => {
    if (ruleName.includes("Success Rate")) {
        return "error-rate";
    }
    if (ruleName.includes("Duration") || ruleName.includes("Throughput")) {
        return "performance";
    }
    if (ruleName.includes("Contention")) {
        return "resource";
    }
    return "performance";
};

const buildAlertId = (ruleName: string, timestamp: Date): string => `${ruleName}-${timestamp.getTime()}`;

export const createAlertRules = (): AlertRule[] => [
    {
        name: "Low Success Rate",
        condition: (metrics) => (metrics.successRate || 1) < 0.8,
        severity: "high",
        message: "Success rate dropped below 80%",
        threshold: 0.8
    },
    {
        name: "Critical Success Rate",
        condition: (metrics) => (metrics.successRate || 1) < 0.5,
        severity: "critical",
        message: "Success rate dropped below 50%",
        threshold: 0.5
    },
    {
        name: "High Average Duration",
        condition: (metrics) => (metrics.averageDuration || 0) > 1000,
        severity: "medium",
        message: "Average operation duration exceeded 1000ms",
        threshold: 1000
    },
    {
        name: "Critical Average Duration",
        condition: (metrics) => (metrics.averageDuration || 0) > 2000,
        severity: "high",
        message: "Average operation duration exceeded 2000ms",
        threshold: 2000
    },
    {
        name: "Low Throughput",
        condition: (metrics) => (metrics.operationsPerSecond || 0) < 5,
        severity: "medium",
        message: "Operations per second dropped below 5",
        threshold: 5
    },
    {
        name: "High Contention",
        condition: (metrics) => {
            const rate = metrics.resourceUtilization?.lockContentionRate || 0;
            return rate > 0.3;
        },
        severity: "medium",
        message: "Lock contention rate exceeded 30%",
        threshold: 0.3
    },
    {
        name: "Critical Contention",
        condition: (metrics) => {
            const rate = metrics.resourceUtilization?.lockContentionRate || 0;
            return rate > 0.5;
        },
        severity: "high",
        message: "Lock contention rate exceeded 50%",
        threshold: 0.5
    }
];

export const evaluateAlerts = (
    metrics: Partial<MixedOperationMetrics>,
    alertRules: AlertRule[]
): PerformanceAlert[] => {
    const initialAlerts: PerformanceAlert[] = [];

    return alertRules.reduce((alerts, rule) => {
        if (!rule.condition(metrics)) {
            return alerts;
        }

        const alertTimestamp = new Date();
        const alert: PerformanceAlert = {
            id: buildAlertId(rule.name, alertTimestamp),
            severity: rule.severity,
            type: getAlertType(rule.name),
            message: rule.message,
            threshold: rule.threshold,
            currentValue: getAlertValue(rule.name, metrics),
            timestamp: alertTimestamp,
            resolved: false
        };

        return [...alerts, alert];
    }, initialAlerts);
};
