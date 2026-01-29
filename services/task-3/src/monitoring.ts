// Performance Metrics and Monitoring System for Mixed Base 3 Operations - Task b7c2d592-load

import type {
    MixedOperationMetrics,
    PerformanceBaseline,
    MixedOperationResult,
    TaskEntity,
    TaskOperation
} from "./types.ts";

export interface PerformanceSnapshot {
    timestamp: Date;
    metrics: Partial<MixedOperationMetrics>;
    systemHealth: {
        cpuUsage: number;
        memoryUsage: number;
        activeConnections: number;
        queueSize: number;
    };
    alerts: PerformanceAlert[];
}

export interface PerformanceAlert {
    id: string;
    severity: "low" | "medium" | "high" | "critical";
    type: "performance" | "error-rate" | "resource" | "throughput";
    message: string;
    threshold: number;
    currentValue: number;
    timestamp: Date;
    resolved: boolean;
    resolvedAt?: Date;
}

export interface PerformanceTrend {
    metric: string;
    timeframe: "1m" | "5m" | "15m" | "1h" | "6h" | "24h";
    trend: "increasing" | "decreasing" | "stable" | "volatile";
    changeRate: number;
    prediction: {
        nextValue: number;
        confidence: number;
        timeframe: string;
    };
}

export interface PerformanceReport {
    generatedAt: Date;
    timeframe: string;
    summary: {
        totalOperations: number;
        successRate: number;
        averageDuration: number;
        throughput: number;
        errorRate: number;
    };
    operationBreakdown: Record<string, {
        count: number;
        successRate: number;
        avgDuration: number;
        throughput: number;
    }>;
    trends: PerformanceTrend[];
    alerts: PerformanceAlert[];
    recommendations: string[];
}

export class PerformanceMonitor {
    private snapshots: PerformanceSnapshot[] = [];
    private baselines: Map<string, PerformanceBaseline> = new Map();
    private alerts: PerformanceAlert[] = [];
    private alertRules: Array<{
        name: string;
        condition: (metrics: Partial<MixedOperationMetrics>) => boolean;
        severity: PerformanceAlert["severity"];
        message: string;
        threshold: number;
    }> = [];
    private maxSnapshots = 1000;

    constructor() {
        this.initializeAlertRules();
        this.initializeBaselines();
    }

    /**
     * Record a performance snapshot
     */
    recordSnapshot(metrics: Partial<MixedOperationMetrics>, systemHealth?: PerformanceSnapshot["systemHealth"]): void {
        const snapshot: PerformanceSnapshot = {
            timestamp: new Date(),
            metrics,
            systemHealth: systemHealth || this.getDefaultSystemHealth(),
            alerts: this.evaluateAlerts(metrics)
        };

        this.snapshots.push(snapshot);

        // Limit snapshots to prevent memory issues
        if (this.snapshots.length > this.maxSnapshots) {
            this.snapshots = this.snapshots.slice(-this.maxSnapshots);
        }

        // Add new alerts to the alerts list
        this.alerts.push(...snapshot.alerts);
    }

    /**
     * Get current performance metrics
     */
    getCurrentMetrics(): Partial<MixedOperationMetrics> | null {
        return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1].metrics : null;
    }

    /**
     * Get recent performance history
     */
    getRecentHistory(minutes: number = 30): PerformanceSnapshot[] {
        const cutoffTime = new Date(Date.now() - minutes * 60 * 1000);
        return this.snapshots.filter(snapshot => snapshot.timestamp >= cutoffTime);
    }

    /**
     * Calculate performance trends
     */
    calculateTrends(timeframe: "1m" | "5m" | "15m" | "1h" | "6h" | "24h" = "15m"): PerformanceTrend[] {
        const snapshots = this.getRecentHistory(this.getTimeframeMinutes(timeframe));
        
        if (snapshots.length < 2) {
            return [];
        }

        const trends: PerformanceTrend[] = [];
        const metrics = [
            "successRate",
            "averageDuration", 
            "operationsPerSecond",
            "contentionEvents",
            "errorRecoveryEvents"
        ];

        metrics.forEach(metric => {
            const trend = this.calculateMetricTrend(metric, snapshots, timeframe);
            if (trend) {
                trends.push(trend);
            }
        });

        return trends;
    }

    /**
     * Calculate specific metric trend
     */
    private calculateMetricTrend(
        metric: string,
        snapshots: PerformanceSnapshot[],
        timeframe: "1m" | "5m" | "15m" | "1h" | "6h" | "24h"
    ): PerformanceTrend | null {
        const values = snapshots
            .map(s => s.metrics[metric as keyof MixedOperationMetrics])
            .filter(v => typeof v === "number") as number[];

        if (values.length < 2) {
            return null;
        }

        const firstValue = values[0];
        const lastValue = values[values.length - 1];
        const changeRate = (lastValue - firstValue) / firstValue;

        let trend: PerformanceTrend["trend"];
        if (Math.abs(changeRate) < 0.05) {
            trend = "stable";
        } else if (changeRate > 0) {
            trend = "increasing";
        } else {
            trend = "decreasing";
        }

        // Simple linear prediction
        const prediction = {
            nextValue: lastValue + (lastValue - firstValue) / values.length,
            confidence: Math.max(0.1, 1 - (Math.abs(changeRate) * 2)),
            timeframe: timeframe
        };

        return {
            metric,
            timeframe,
            trend,
            changeRate,
            prediction
        };
    }

    /**
     * Generate comprehensive performance report
     */
    generateReport(timeframe: "1h" | "6h" | "24h" = "1h"): PerformanceReport {
        const snapshots = this.getRecentHistory(this.getTimeframeMinutes(timeframe));
        
        if (snapshots.length === 0) {
            throw new Error("No performance data available for report generation");
        }

        const latestSnapshot = snapshots[snapshots.length - 1];
        const metrics = latestSnapshot.metrics;

        // Calculate summary
        const summary = {
            totalOperations: metrics.totalOperations || 0,
            successRate: metrics.successRate || 0,
            averageDuration: metrics.averageDuration || 0,
            throughput: metrics.operationsPerSecond || 0,
            errorRate: 1 - (metrics.successRate || 0)
        };

        // Calculate operation breakdown
        const operationBreakdown = this.calculateOperationBreakdown(snapshots);

        // Get trends
        const trends = this.calculateTrends(timeframe);

        // Get recent alerts
        const alertCutoff = new Date(Date.now() - this.getTimeframeMinutes(timeframe) * 60 * 1000);
        const recentAlerts = this.alerts.filter(alert => alert.timestamp >= alertCutoff && !alert.resolved);

        // Generate recommendations
        const recommendations = this.generateRecommendations(summary, trends, recentAlerts);

        return {
            generatedAt: new Date(),
            timeframe,
            summary,
            operationBreakdown,
            trends,
            alerts: recentAlerts,
            recommendations
        };
    }

    /**
     * Calculate operation performance breakdown
     */
    private calculateOperationBreakdown(snapshots: PerformanceSnapshot[]): Record<string, any> {
        const breakdown: Record<string, any> = {};

        snapshots.forEach(snapshot => {
            if (snapshot.metrics.performanceByType) {
                Object.entries(snapshot.metrics.performanceByType).forEach(([operationType, perf]) => {
                    if (!breakdown[operationType]) {
                        breakdown[operationType] = {
                            count: 0,
                            successCount: 0,
                            totalDuration: 0,
                            totalSamples: 0
                        };
                    }

                    const opBreakdown = breakdown[operationType];
                    opBreakdown.count += perf.count;
                    opBreakdown.successCount += perf.count * perf.successRate;
                    opBreakdown.totalDuration += perf.avgDuration * perf.count;
                    opBreakdown.totalSamples += 1;
                });
            }
        });

        // Convert to final format
        Object.keys(breakdown).forEach(operationType => {
            const op = breakdown[operationType];
            breakdown[operationType] = {
                count: op.count,
                successRate: op.successCount / op.count,
                avgDuration: op.totalDuration / op.count,
                throughput: op.count / (snapshots.length * 60) // per second
            };
        });

        return breakdown;
    }

    /**
     * Generate performance recommendations
     */
    private generateRecommendations(
        summary: PerformanceReport["summary"],
        trends: PerformanceTrend[],
        alerts: PerformanceAlert[]
    ): string[] {
        const recommendations: string[] = [];

        // Success rate recommendations
        if (summary.successRate < 0.9) {
            recommendations.push("Success rate is below 90%. Consider reducing concurrency or improving error recovery.");
        }

        // Duration recommendations
        if (summary.averageDuration > 300) {
            recommendations.push("Average operation duration is high. Consider optimizing queries or increasing resources.");
        }

        // Throughput recommendations
        if (summary.throughput < 10) {
            recommendations.push("Low throughput detected. Consider increasing concurrent operations or optimizing performance.");
        }

        // Trend-based recommendations
        trends.forEach(trend => {
            if (trend.metric === "averageDuration" && trend.trend === "increasing") {
                recommendations.push("Operation duration is increasing. Monitor for performance degradation.");
            }

            if (trend.metric === "successRate" && trend.trend === "decreasing") {
                recommendations.push("Success rate is declining. Check for resource contention or system issues.");
            }

            if (trend.metric === "contentionEvents" && trend.trend === "increasing") {
                recommendations.push("Resource contention is increasing. Consider reducing concurrency or optimizing resource usage.");
            }
        });

        // Alert-based recommendations
        const criticalAlerts = alerts.filter(alert => alert.severity === "critical");
        if (criticalAlerts.length > 0) {
            recommendations.push("Critical alerts detected. Immediate investigation required.");
        }

        // Error recovery recommendations
        if (summary.errorRate > 0.1) {
            recommendations.push("High error rate detected. Review error recovery configuration and system health.");
        }

        return recommendations;
    }

    /**
     * Initialize alert rules
     */
    private initializeAlertRules(): void {
        this.alertRules = [
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
    }

    /**
     * Evaluate alert rules against current metrics
     */
    private evaluateAlerts(metrics: Partial<MixedOperationMetrics>): PerformanceAlert[] {
        const triggeredAlerts: PerformanceAlert[] = [];

        this.alertRules.forEach(rule => {
            if (rule.condition(metrics)) {
                const alertId = `${rule.name}-${Date.now()}`;
                const currentValue = this.getAlertValue(rule, metrics);

                const alert: PerformanceAlert = {
                    id: alertId,
                    severity: rule.severity,
                    type: this.getAlertType(rule.name),
                    message: rule.message,
                    threshold: rule.threshold,
                    currentValue,
                    timestamp: new Date(),
                    resolved: false
                };

                triggeredAlerts.push(alert);
            }
        });

        return triggeredAlerts;
    }

    /**
     * Get value for alert evaluation
     */
    private getAlertValue(rule: any, metrics: Partial<MixedOperationMetrics>): number {
        switch (rule.name) {
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
    }

    /**
     * Get alert type based on rule name
     */
    private getAlertType(ruleName: string): PerformanceAlert["type"] {
        if (ruleName.includes("Success Rate")) return "error-rate";
        if (ruleName.includes("Duration") || ruleName.includes("Throughput")) return "performance";
        if (ruleName.includes("Contention")) return "resource";
        return "performance";
    }

    /**
     * Initialize performance baselines
     */
    private initializeBaselines(): void {
        const defaultBaselines: Record<string, PerformanceBaseline> = {
            create: {
                operationType: "create",
                avgDuration: 150,
                p95Duration: 300,
                p99Duration: 600,
                successRate: 0.95,
                throughput: 15,
                sampleSize: 0,
                lastUpdated: new Date()
            },
            read: {
                operationType: "read",
                avgDuration: 50,
                p95Duration: 100,
                p99Duration: 200,
                successRate: 0.98,
                throughput: 40,
                sampleSize: 0,
                lastUpdated: new Date()
            },
            update: {
                operationType: "update",
                avgDuration: 100,
                p95Duration: 200,
                p99Duration: 400,
                successRate: 0.92,
                throughput: 20,
                sampleSize: 0,
                lastUpdated: new Date()
            },
            delete: {
                operationType: "delete",
                avgDuration: 75,
                p95Duration: 150,
                p99Duration: 300,
                successRate: 0.94,
                throughput: 25,
                sampleSize: 0,
                lastUpdated: new Date()
            }
        };

        Object.entries(defaultBaselines).forEach(([type, baseline]) => {
            this.baselines.set(type, baseline);
        });
    }

    /**
     * Update performance baseline with new data
     */
    updateBaseline(operationType: string, duration: number, success: boolean): void {
        const baseline = this.baselines.get(operationType);
        if (!baseline) {
            return;
        }

        // Update with exponential moving average
        const alpha = 0.1; // Smoothing factor
        baseline.avgDuration = baseline.avgDuration * (1 - alpha) + duration * alpha;
        baseline.successRate = baseline.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
        baseline.sampleSize++;
        baseline.lastUpdated = new Date();
    }

    /**
     * Get performance baselines
     */
    getBaselines(): Map<string, PerformanceBaseline> {
        return new Map(this.baselines);
    }

    /**
     * Get active alerts
     */
    getActiveAlerts(): PerformanceAlert[] {
        return this.alerts.filter(alert => !alert.resolved);
    }

    /**
     * Resolve alert
     */
    resolveAlert(alertId: string): boolean {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.resolved = true;
            alert.resolvedAt = new Date();
            return true;
        }
        return false;
    }

    /**
     * Get default system health metrics
     */
    private getDefaultSystemHealth(): PerformanceSnapshot["systemHealth"] {
        return {
            cpuUsage: Math.random() * 0.8, // Simulated
            memoryUsage: Math.random() * 0.7, // Simulated
            activeConnections: Math.floor(Math.random() * 20),
            queueSize: Math.floor(Math.random() * 10)
        };
    }

    /**
     * Convert timeframe to minutes
     */
    private getTimeframeMinutes(timeframe: string): number {
        const timeframeMap: Record<string, number> = {
            "1m": 1,
            "5m": 5,
            "15m": 15,
            "1h": 60,
            "6h": 360,
            "24h": 1440
        };
        return timeframeMap[timeframe] || 15;
    }

    /**
     * Export performance data for analysis
     */
    exportData(timeframe?: "1h" | "6h" | "24h"): {
        snapshots: PerformanceSnapshot[];
        baselines: Record<string, PerformanceBaseline>;
        alerts: PerformanceAlert[];
        exportTime: string;
    } {
        const snapshots = timeframe ? this.getRecentHistory(this.getTimeframeMinutes(timeframe)) : this.snapshots;
        
        return {
            snapshots,
            baselines: Object.fromEntries(this.baselines),
            alerts: this.alerts,
            exportTime: new Date().toISOString()
        };
    }

    /**
     * Reset performance data
     */
    resetData(): void {
        this.snapshots = [];
        this.alerts = [];
        this.initializeBaselines();
    }

    /**
     * Get performance statistics
     */
    getStatistics(): {
        totalSnapshots: number;
        totalAlerts: number;
        activeAlerts: number;
        avgSuccessRate: number;
        avgDuration: number;
        alertSeverityBreakdown: Record<string, number>;
    } {
        const activeAlerts = this.getActiveAlerts();
        const alertSeverityBreakdown: Record<string, number> = {};

        this.alerts.forEach(alert => {
            alertSeverityBreakdown[alert.severity] = (alertSeverityBreakdown[alert.severity] || 0) + 1;
        });

        const validSnapshots = this.snapshots.filter(s => s.metrics.successRate && s.metrics.averageDuration);
        const avgSuccessRate = validSnapshots.length > 0 
            ? validSnapshots.reduce((sum, s) => sum + (s.metrics.successRate || 0), 0) / validSnapshots.length 
            : 0;
        const avgDuration = validSnapshots.length > 0 
            ? validSnapshots.reduce((sum, s) => sum + (s.metrics.averageDuration || 0), 0) / validSnapshots.length 
            : 0;

        return {
            totalSnapshots: this.snapshots.length,
            totalAlerts: this.alerts.length,
            activeAlerts: activeAlerts.length,
            avgSuccessRate,
            avgDuration,
            alertSeverityBreakdown
        };
    }
}

// Export singleton instance
export const performanceMonitor = new PerformanceMonitor();

export default performanceMonitor;