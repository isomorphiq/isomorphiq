import type { MixedOperationMetrics } from "../types.ts";
import type { PerformanceSnapshot, PerformanceTrend } from "./types.ts";

const metricKeys: Array<keyof MixedOperationMetrics> = [
    "successRate",
    "averageDuration",
    "operationsPerSecond",
    "contentionEvents",
    "errorRecoveryEvents"
];

export const calculateTrends = (
    snapshots: PerformanceSnapshot[],
    timeframe: PerformanceTrend["timeframe"]
): PerformanceTrend[] => {
    if (snapshots.length < 2) {
        return [];
    }

    return metricKeys
        .map((metric) => calculateMetricTrend(metric, snapshots, timeframe))
        .filter((trend): trend is PerformanceTrend => trend !== null);
};

const calculateMetricTrend = (
    metric: keyof MixedOperationMetrics,
    snapshots: PerformanceSnapshot[],
    timeframe: PerformanceTrend["timeframe"]
): PerformanceTrend | null => {
    const values = snapshots
        .map((snapshot) => snapshot.metrics[metric])
        .filter((value): value is number => typeof value === "number");

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

    const prediction = {
        nextValue: lastValue + (lastValue - firstValue) / values.length,
        confidence: Math.max(0.1, 1 - Math.abs(changeRate) * 2),
        timeframe
    };

    return {
        metric: metric.toString(),
        timeframe,
        trend,
        changeRate,
        prediction
    };
};
