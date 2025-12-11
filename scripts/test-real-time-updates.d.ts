#!/usr/bin/env node
/**
 * Test suite for real-time updates in dashboard
 * Tests WebSocket connections, tRPC subscriptions, and live data synchronization
 */
declare class RealTimeUpdatesTester {
    private pm;
    private server;
    private baseUrl;
    private results;
    constructor();
    private runTest;
    private createWebSocketConnection;
    private sendTRPCSubscription;
    private waitForMessage;
    setup(): Promise<void>;
    cleanup(): Promise<void>;
    testWebSocketConnection(): Promise<void>;
    testTRPCSubscription(): Promise<void>;
    testRealTimeTaskCreation(): Promise<void>;
    testRealTimeTaskUpdates(): Promise<void>;
    testMultipleSubscribers(): Promise<void>;
    testConnectionResilience(): Promise<void>;
    testSubscriptionFiltering(): Promise<void>;
    runAllTests(): Promise<void>;
}
export { RealTimeUpdatesTester };
//# sourceMappingURL=test-real-time-updates.d.ts.map