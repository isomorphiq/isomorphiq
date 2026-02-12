import type { MixedOperationMetrics, PerformanceBaseline } from "../types.ts";
import { createAlertRules, evaluateAlerts } from "./alert-service.ts";
import { createDefaultBaselines, updateBaseline as updateBaselineValue, cloneBaselines } from "./baseline-manager.ts";
import { generateReport as buildReport } from "./report-generator.ts";
import { createSnapshot } from "./snapshot-service.ts";
import { getTimeframeMinutes } from "./timeframe.ts";
import { calculateTrends as buildTrends } from "./trend-analyzer.ts";
import type {
    AlertRule,
    PerformanceAlert,
    PerformanceBaselineMap,
    PerformanceReport,
    PerformanceSnapshot,
    PerformanceTrend
} from "./types.ts";
export type {
    AlertRule,
    PerformanceAlert,
    PerformanceReport,
    PerformanceSnapshot,
    PerformanceTrend
} from "./types.ts";

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PerformanceMonitor {
    private snapshots: PerformanceSnapshot[] = [];
    private baselines: PerformanceBaselineMap;
    private alerts: PerformanceAlert[] = [];
    private alertRules: AlertRule[];
    private readonly maxSnapshots = 1000;

    constructor() {
        this.alertRules = createAlertRules();
        this.baselines = createDefaultBaselines();
    }

    /**
     * Record a performance snapshot
     */
    recordSnapshot(
        metrics: Partial<MixedOperationMetrics>,
        systemHealth?: PerformanceSnapshot["systemHealth"]
    ): void {
        const alerts = evaluateAlerts(metrics, this.alertRules);
        const snapshot = createSnapshot(metrics, alerts, systemHealth, new Date());
        const nextSnapshots = [...this.snapshots, snapshot];

        this.snapshots = nextSnapshots.length > this.maxSnapshots
            ? nextSnapshots.slice(-this.maxSnapshots)
            : nextSnapshots;
        this.alerts = [...this.alerts, ...snapshot.alerts];
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
        return this.snapshots.filter((snapshot) => snapshot.timestamp >= cutoffTime);
    }

    /**
     * Calculate performance trends
     */
    calculateTrends(
        timeframe: PerformanceTrend["timeframe"] = "15m"
    ): PerformanceTrend[] {
        const snapshots = this.getRecentHistory(getTimeframeMinutes(timeframe));
        return buildTrends(snapshots, timeframe);
    }

    /**
     * Generate comprehensive performance report
     */
    generateReport(timeframe: "1h" | "6h" | "24h" = "1h"): PerformanceReport {
        const snapshots = this.getRecentHistory(getTimeframeMinutes(timeframe));
        return buildReport(snapshots, this.alerts, timeframe);
    }

    /**
     * Update performance baseline with new data
     */
    updateBaseline(operationType: string, duration: number, success: boolean): void {
        this.baselines = updateBaselineValue(this.baselines, operationType, duration, success, new Date());
    }

    /**
     * Get performance baselines
     */
    getBaselines(): Map<string, PerformanceBaseline> {
        return cloneBaselines(this.baselines);
    }

    /**
     * Get active alerts
     */
    getActiveAlerts(): PerformanceAlert[] {
        return this.alerts.filter((alert) => !alert.resolved);
    }

    /**
     * Resolve alert
     */
    resolveAlert(alertId: string): boolean {
        let resolved = false;
        const resolvedAt = new Date();

        const nextAlerts = this.alerts.map((alert) => {
            if (alert.id !== alertId) {
                return alert;
            }
            resolved = true;
            return {
                ...alert,
                resolved: true,
                resolvedAt
            };
        });

        if (resolved) {
            this.alerts = nextAlerts;
        }

        return resolved;
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
        const snapshots = timeframe
            ? this.getRecentHistory(getTimeframeMinutes(timeframe))
            : this.snapshots;

        return {
            snapshots: [...snapshots],
            baselines: Object.fromEntries(this.baselines),
            alerts: [...this.alerts],
            exportTime: new Date().toISOString()
        };
    }

    /**
     * Reset performance data
     */
    resetData(): void {
        this.snapshots = [];
        this.alerts = [];
        this.baselines = createDefaultBaselines();
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
        const initialBreakdown: Record<string, number> = {};
        const alertSeverityBreakdown = this.alerts.reduce((acc, alert) => ({
            ...acc,
            [alert.severity]: (acc[alert.severity] || 0) + 1
        }), initialBreakdown);

        const validSnapshots = this.snapshots.filter(
            (snapshot) => snapshot.metrics.successRate && snapshot.metrics.averageDuration
        );

        const avgSuccessRate = validSnapshots.length > 0
            ? validSnapshots.reduce((sum, snapshot) => sum + (snapshot.metrics.successRate || 0), 0)
                / validSnapshots.length
            : 0;

        const avgDuration = validSnapshots.length > 0
            ? validSnapshots.reduce((sum, snapshot) => sum + (snapshot.metrics.averageDuration || 0), 0)
                / validSnapshots.length
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

export const performanceMonitor = new PerformanceMonitor();

export default performanceMonitor;

