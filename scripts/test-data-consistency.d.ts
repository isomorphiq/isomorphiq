#!/usr/bin/env node
/**
 * Comprehensive test suite for data consistency across analytics endpoints
 * Tests data integrity between /api/tasks, /api/stats, /api/analytics, and tRPC endpoints
 */
declare class DataConsistencyTester {
    private pm;
    private server;
    private baseUrl;
    private results;
    constructor();
    private runTest;
    private fetchEndpoint;
    private fetchTRPC;
    setup(): Promise<void>;
    cleanup(): Promise<void>;
    testBasicDataConsistency(): Promise<void>;
    testQueueConsistency(): Promise<void>;
    testAnalyticsCalculations(): Promise<void>;
    testTimelineConsistency(): Promise<void>;
    testFilteringConsistency(): Promise<void>;
    testRealTimeDataConsistency(): Promise<void>;
    runAllTests(): Promise<void>;
}
export { DataConsistencyTester };
//# sourceMappingURL=test-data-consistency.d.ts.map