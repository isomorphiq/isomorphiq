import type { PerformanceBaseline } from "../types.ts";
import type { PerformanceBaselineMap } from "./types.ts";

export const createDefaultBaselines = (): PerformanceBaselineMap => {
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

    return new Map(Object.entries(defaultBaselines));
};

export const updateBaseline = (
    baselines: PerformanceBaselineMap,
    operationType: string,
    duration: number,
    success: boolean,
    timestamp: Date = new Date()
): PerformanceBaselineMap => {
    const baseline = baselines.get(operationType);
    if (!baseline) {
        return new Map(baselines);
    }

    const alpha = 0.1; // Smoothing factor
    const updatedBaseline: PerformanceBaseline = {
        ...baseline,
        avgDuration: baseline.avgDuration * (1 - alpha) + duration * alpha,
        successRate: baseline.successRate * (1 - alpha) + (success ? 1 : 0) * alpha,
        sampleSize: baseline.sampleSize + 1,
        lastUpdated: timestamp
    };

    const nextBaselines = new Map(baselines);
    nextBaselines.set(operationType, updatedBaseline);
    return nextBaselines;
};

export const cloneBaselines = (baselines: PerformanceBaselineMap): PerformanceBaselineMap => new Map(baselines);
