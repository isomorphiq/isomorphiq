import type { MixedOperationMetrics } from "../types.ts";
import type { PerformanceAlert, PerformanceSnapshot } from "./types.ts";

export const getDefaultSystemHealth = (): PerformanceSnapshot["systemHealth"] => ({
    cpuUsage: Math.random() * 0.8,
    memoryUsage: Math.random() * 0.7,
    activeConnections: Math.floor(Math.random() * 20),
    queueSize: Math.floor(Math.random() * 10)
});

export const createSnapshot = (
    metrics: Partial<MixedOperationMetrics>,
    alerts: PerformanceAlert[],
    systemHealth?: PerformanceSnapshot["systemHealth"],
    timestamp: Date = new Date()
): PerformanceSnapshot => ({
    timestamp,
    metrics,
    systemHealth: systemHealth || getDefaultSystemHealth(),
    alerts
});
