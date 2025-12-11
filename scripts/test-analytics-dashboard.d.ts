#!/usr/bin/env node
/**
 * Test suite for analytics accuracy and dashboard functionality
 * Tests the /api/analytics endpoint for data accuracy and consistency
 */
declare class AnalyticsTester {
    private pm;
    private results;
    constructor();
    private runTest;
    private getTestData;
    testAnalyticsAccuracy(): Promise<void>;
    testStatsConsistency(): Promise<void>;
    testTimelineData(): Promise<void>;
    testPerformanceMetrics(): Promise<void>;
    testEdgeCases(): Promise<void>;
    runAllTests(): Promise<void>;
}
export { AnalyticsTester };
//# sourceMappingURL=test-analytics-dashboard.d.ts.map