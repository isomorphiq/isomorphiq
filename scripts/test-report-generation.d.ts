#!/usr/bin/env node
/**
 * Test suite for report generation capabilities
 * Tests various report formats, data aggregation, and export functionality
 */
declare class ReportGeneratorTester {
    private pm;
    private results;
    constructor();
    private runTest;
    private generateReportData;
    testJSONReportGeneration(): Promise<void>;
    testCSVReportGeneration(): Promise<void>;
    testHTMLReportGeneration(): Promise<void>;
    private generateHTMLReport;
    testPDFReportGeneration(): Promise<void>;
    testReportAggregation(): Promise<void>;
    testReportFileOutput(): Promise<void>;
    testReportPerformance(): Promise<void>;
    runAllTests(): Promise<void>;
}
export { ReportGeneratorTester };
//# sourceMappingURL=test-report-generation.d.ts.map