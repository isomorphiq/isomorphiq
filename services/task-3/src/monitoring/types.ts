import type { MixedOperationMetrics, PerformanceBaseline } from "../types.ts";

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

export type AlertRule = {
    name: string;
    condition: (metrics: Partial<MixedOperationMetrics>) => boolean;
    severity: PerformanceAlert["severity"];
    message: string;
    threshold: number;
};

export type PerformanceBaselineMap = Map<string, PerformanceBaseline>;
