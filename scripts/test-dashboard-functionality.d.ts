#!/usr/bin/env node
/**
 * Test suite for dashboard functionality and UI components
 * Tests the web dashboard components, state management, and real-time updates
 */
declare class DashboardTester {
    private pm;
    private server;
    private baseUrl;
    private results;
    constructor();
    private runTest;
    setup(): Promise<void>;
    cleanup(): Promise<void>;
    testApiEndpoints(): Promise<void>;
    testTaskCRUD(): Promise<void>;
    testFilteringAndSearch(): Promise<void>;
    testTRPCEndpoints(): Promise<void>;
    testDataConsistency(): Promise<void>;
    testErrorHandling(): Promise<void>;
    runAllTests(): Promise<void>;
}
export { DashboardTester };
//# sourceMappingURL=test-dashboard-functionality.d.ts.map