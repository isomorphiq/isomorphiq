import type { MixedOperationMetrics } from "../types.ts";
import type { PerformanceAlert, PerformanceReport, PerformanceSnapshot, PerformanceTrend } from "./types.ts";
import { calculateTrends } from "./trend-analyzer.ts";
import { getTimeframeMinutes } from "./timeframe.ts";

const calculateOperationBreakdown = (
    snapshots: PerformanceSnapshot[]
): PerformanceReport["operationBreakdown"] => {
    const initialBreakdown: Record<string, {
        count: number;
        successCount: number;
        totalDuration: number;
        totalSamples: number;
    }> = {};

    const aggregated = snapshots.reduce((acc, snapshot) => {
        const performanceByType = snapshot.metrics.performanceByType;
        if (!performanceByType) {
            return acc;
        }

        return Object.entries(performanceByType).reduce((nextAcc, [operationType, perf]) => {
            const existing = nextAcc[operationType] || {
                count: 0,
                successCount: 0,
                totalDuration: 0,
                totalSamples: 0
            };

            const updated = {
                count: existing.count + perf.count,
                successCount: existing.successCount + perf.count * perf.successRate,
                totalDuration: existing.totalDuration + perf.avgDuration * perf.count,
                totalSamples: existing.totalSamples + 1
            };

            return {
                ...nextAcc,
                [operationType]: updated
            };
        }, acc);
    }, initialBreakdown);

    return Object.fromEntries(
        Object.entries(aggregated).map(([operationType, op]) => [
            operationType,
            {
                count: op.count,
                successRate: op.successCount / op.count,
                avgDuration: op.totalDuration / op.count,
                throughput: op.count / (snapshots.length * 60)
            }
        ])
    );
};

const generateRecommendations = (
    summary: PerformanceReport["summary"],
    trends: PerformanceTrend[],
    alerts: PerformanceAlert[]
): string[] => {
    const trendRecommendations = trends.flatMap((trend) => {
        if (trend.metric === "averageDuration" && trend.trend === "increasing") {
            return ["Operation duration is increasing. Monitor for performance degradation."];
        }

        if (trend.metric === "successRate" && trend.trend === "decreasing") {
            return ["Success rate is declining. Check for resource contention or system issues."];
        }

        if (trend.metric === "contentionEvents" && trend.trend === "increasing") {
            return ["Resource contention is increasing. Consider reducing concurrency or optimizing resource usage."];
        }

        return [];
    });

    const criticalAlerts = alerts.filter((alert) => alert.severity === "critical");

    return [
        ...(summary.successRate < 0.9
            ? ["Success rate is below 90%. Consider reducing concurrency or improving error recovery."]
            : []),
        ...(summary.averageDuration > 300
            ? ["Average operation duration is high. Consider optimizing queries or increasing resources."]
            : []),
        ...(summary.throughput < 10
            ? ["Low throughput detected. Consider increasing concurrent operations or optimizing performance."]
            : []),
        ...trendRecommendations,
        ...(criticalAlerts.length > 0
            ? ["Critical alerts detected. Immediate investigation required."]
            : []),
        ...(summary.errorRate > 0.1
            ? ["High error rate detected. Review error recovery configuration and system health."]
            : [])
    ];
};

const buildSummary = (metrics: Partial<MixedOperationMetrics>): PerformanceReport["summary"] => ({
    totalOperations: metrics.totalOperations || 0,
    successRate: metrics.successRate || 0,
    averageDuration: metrics.averageDuration || 0,
    throughput: metrics.operationsPerSecond || 0,
    errorRate: 1 - (metrics.successRate || 0)
});

export const generateReport = (
    snapshots: PerformanceSnapshot[],
    alerts: PerformanceAlert[],
    timeframe: "1h" | "6h" | "24h"
): PerformanceReport => {
    if (snapshots.length === 0) {
        throw new Error("No performance data available for report generation");
    }

    const latestSnapshot = snapshots[snapshots.length - 1];
    const summary = buildSummary(latestSnapshot.metrics);
    const operationBreakdown = calculateOperationBreakdown(snapshots);
    const trends = calculateTrends(snapshots, timeframe);

    const alertCutoff = new Date(Date.now() - getTimeframeMinutes(timeframe) * 60 * 1000);
    const recentAlerts = alerts.filter((alert) => alert.timestamp >= alertCutoff && !alert.resolved);
    const recommendations = generateRecommendations(summary, trends, recentAlerts);

    return {
        generatedAt: new Date(),
        timeframe,
        summary,
        operationBreakdown,
        trends,
        alerts: recentAlerts,
        recommendations
    };
};
