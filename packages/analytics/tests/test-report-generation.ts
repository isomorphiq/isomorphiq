#!/usr/bin/env node
import "../../../tests/test-utils/env-fetch.ts";

/**
 * Test suite for report generation capabilities
 * Tests various report formats, data aggregation, and export functionality
 */

import { ProductManager } from "@isomorphiq/profiles";
import fs from "node:fs";
import type { Task } from "@isomorphiq/tasks";

interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	duration: number;
}

interface ReportSummary {
	generatedAt: string;
	period: string;
	totalTasks: number;
	completionRate: number;
	productivityScore: string;
	avgCompletionTime: string;
}

interface ReportAnalytics {
	overview: {
		totalTasks: number;
		completedTasks: number;
		inProgressTasks: number;
		todoTasks: number;
		completionRate: number;
	};
	today: {
		created: number;
		completed: number;
	};
	priority: {
		high: number;
		medium: number;
		low: number;
	};
	performance: {
		avgCompletionTime: string;
		productivityScore: string;
		totalActiveTasks: number;
	};
}

interface TimelineEntry {
	date: string;
	created: number;
	completed: number;
}

interface ReportData {
	summary: ReportSummary;
	tasks: Task[];
	analytics: ReportAnalytics;
	timeline: TimelineEntry[];
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class ReportGeneratorTester {
	private pm: ProductManager;
	private results: TestResult[] = [];

	constructor() {
		this.pm = new ProductManager();
	}

	private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
		const startTime = Date.now();
		try {
			await testFn();
			this.results.push({
				name,
				passed: true,
				duration: Date.now() - startTime,
			});
			console.log(`✅ ${name}`);
		} catch (error) {
			this.results.push({
				name,
				passed: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - startTime,
			});
			console.log(`❌ ${name}: ${error}`);
		}
	}

	private async generateReportData(): Promise<ReportData> {
		const tasks = (await this.pm.getAllTasks()) || [];

		// Generate summary statistics
		const totalTasks = tasks.length;
		const completedTasks = tasks.filter((t) => t.status === "done").length;
		const inProgressTasks = tasks.filter((t) => t.status === "in-progress").length;
		const todoTasks = tasks.filter((t) => t.status === "todo").length;
		const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

		// Priority breakdown
		const highPriorityTasks = tasks.filter((t) => t.priority === "high").length;
		const mediumPriorityTasks = tasks.filter((t) => t.priority === "medium").length;
		const lowPriorityTasks = tasks.filter((t) => t.priority === "low").length;

		// Today's statistics
		const today = new Date();
		const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
		const todayEnd = new Date(todayStart);
		todayEnd.setDate(todayEnd.getDate() + 1);

		const todayCreated = tasks.filter((t) => {
			const taskDate = new Date(t.createdAt);
			return taskDate >= todayStart && taskDate < todayEnd;
		}).length;

		const todayCompleted = tasks.filter((t) => {
			if (t.status !== "done") return false;
			const taskDate = new Date(t.updatedAt);
			return taskDate >= todayStart && taskDate < todayEnd;
		}).length;

		// Timeline data (last 30 days)
		const timelineData = [];
		const now = new Date();

		for (let i = 29; i >= 0; i--) {
			const date = new Date();
			date.setDate(date.getDate() - i);
			date.setHours(0, 0, 0, 0);

			const nextDate = new Date(date);
			nextDate.setDate(nextDate.getDate() + 1);

			const dayCreated = tasks.filter((t) => {
				const taskDate = new Date(t.createdAt);
				return taskDate >= date && taskDate < nextDate;
			}).length;

			const dayCompleted = tasks.filter((t) => {
				if (t.status !== "done") return false;
				const taskDate = new Date(t.updatedAt);
				return taskDate >= date && taskDate < nextDate;
			}).length;

			timelineData.push({
				date: date.toISOString().split("T")[0],
				created: dayCreated,
				completed: dayCompleted,
				active: dayCreated - dayCompleted,
			});
		}

		// Analytics data
		const analytics = {
			overview: {
				totalTasks,
				completedTasks,
				inProgressTasks,
				todoTasks,
				completionRate,
			},
			today: {
				created: todayCreated,
				completed: todayCompleted,
			},
			priority: {
				high: highPriorityTasks,
				medium: mediumPriorityTasks,
				low: lowPriorityTasks,
			},
			performance: {
				avgCompletionTime: completedTasks > 0 ? "2.3 days" : "0 days",
				productivityScore:
					totalTasks > 0
						? `${Math.min(100, Math.round((completedTasks / totalTasks) * 100))}%`
						: "0%",
				totalActiveTasks: inProgressTasks + todoTasks,
			},
		};

		const summary = {
			generatedAt: now.toISOString(),
			period: "Last 30 days",
			totalTasks,
			completionRate,
			productivityScore: analytics.performance.productivityScore,
			avgCompletionTime: analytics.performance.avgCompletionTime,
		};

		return {
			summary,
			tasks,
			analytics,
			timeline: timelineData,
		};
	}

	async testJSONReportGeneration(): Promise<void> {
		await this.runTest("JSON report generation", async () => {
			const reportData = await this.generateReportData();

			// Validate report structure
			if (
				!reportData.summary ||
				!reportData.tasks ||
				!reportData.analytics ||
				!reportData.timeline
			) {
				throw new Error("Report missing required sections");
			}

			// Validate summary
			if (typeof reportData.summary.totalTasks !== "number" || reportData.summary.totalTasks < 0) {
				throw new Error("Invalid total tasks in summary");
			}

			if (
				typeof reportData.summary.completionRate !== "number" ||
				reportData.summary.completionRate < 0 ||
				reportData.summary.completionRate > 100
			) {
				throw new Error("Invalid completion rate in summary");
			}

			// Validate analytics
			if (
				!reportData.analytics.overview ||
				!reportData.analytics.priority ||
				!reportData.analytics.performance
			) {
				throw new Error("Analytics section incomplete");
			}

			// Validate timeline
			if (!Array.isArray(reportData.timeline) || reportData.timeline.length !== 30) {
				throw new Error("Timeline should have 30 days of data");
			}

			const timelineHasValidData = reportData.timeline.every(
				(day) =>
					day.date &&
					typeof day.created === "number" &&
					typeof day.completed === "number" &&
					typeof day.active === "number",
			);

			if (!timelineHasValidData) {
				throw new Error("Timeline data structure invalid");
			}
		});
	}

	async testCSVReportGeneration(): Promise<void> {
		await this.runTest("CSV report generation", async () => {
			const reportData = await this.generateReportData();

			// Generate CSV content
			const csvHeaders = ["Date", "Tasks Created", "Tasks Completed", "Active Tasks"];
			const csvRows = reportData.timeline.map((day) =>
				[day.date, day.created, day.completed, day.active].join(","),
			);

			const csvContent = [csvHeaders.join(","), ...csvRows].join("\n");

			// Validate CSV structure
			const lines = csvContent.split("\n");
			if (lines.length < 2) {
				throw new Error("CSV should have header and at least one data row");
			}

			// Check header
			const header = lines[0]?.split(",");
			if (!header || header.length !== 4 || header[0] !== "Date") {
				throw new Error("CSV header incorrect");
			}

			// Check data rows
			for (let i = 1; i < lines.length; i++) {
				const row = lines[i]?.split(",");
				if (!row || row.length !== 4) {
					throw new Error(`CSV row ${i} has incorrect number of columns`);
				}

				// Validate numeric columns
				const created = parseInt(row[1] || "0", 10);
				const completed = parseInt(row[2] || "0", 10);
				const active = parseInt(row[3] || "0", 10);

				if (Number.isNaN(created) || Number.isNaN(completed) || Number.isNaN(active)) {
					throw new Error(`CSV row ${i} has invalid numeric data`);
				}

				if (created < 0 || completed < 0) {
					throw new Error(`CSV row ${i} has negative counts`);
				}
			}
		});
	}

	async testHTMLReportGeneration(): Promise<void> {
		await this.runTest("HTML report generation", async () => {
			const reportData = await this.generateReportData();

			// Generate HTML content
			const htmlContent = this.generateHTMLReport(reportData);

			// Validate HTML structure
			if (!htmlContent.includes("<!DOCTYPE html>")) {
				throw new Error("HTML missing DOCTYPE");
			}

			if (!htmlContent.includes("<html") || !htmlContent.includes("</html>")) {
				throw new Error("HTML missing html tags");
			}

			if (!htmlContent.includes("<head>") || !htmlContent.includes("</head>")) {
				throw new Error("HTML missing head tags");
			}

			if (!htmlContent.includes("<body>") || !htmlContent.includes("</body>")) {
				throw new Error("HTML missing body tags");
			}

			// Check for key content
			if (!htmlContent.includes("Task Management Report")) {
				throw new Error("HTML missing report title");
			}

			if (
				!htmlContent.includes("Summary") ||
				!htmlContent.includes("Analytics") ||
				!htmlContent.includes("Timeline")
			) {
				throw new Error("HTML missing required sections");
			}

			// Check for data values
			if (!htmlContent.includes(reportData.summary.totalTasks.toString())) {
				throw new Error("HTML missing total tasks data");
			}

			if (!htmlContent.includes(reportData.summary.completionRate.toString())) {
				throw new Error("HTML missing completion rate data");
			}
		});
	}

	private generateHTMLReport(data: ReportData): string {
		return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Task Management Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .metric { display: inline-block; margin: 10px; padding: 10px; background: #e9ecef; border-radius: 3px; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Task Management Report</h1>
        <p>Generated on: ${data.summary.generatedAt}</p>
        <p>Period: ${data.summary.period}</p>
    </div>

    <div class="section">
        <h2>Summary</h2>
        <div class="metric">Total Tasks: ${data.summary.totalTasks}</div>
        <div class="metric">Completion Rate: ${data.summary.completionRate}%</div>
        <div class="metric">Productivity Score: ${data.summary.productivityScore}</div>
        <div class="metric">Avg Completion Time: ${data.summary.avgCompletionTime}</div>
    </div>

    <div class="section">
        <h2>Analytics</h2>
        <h3>Task Status Breakdown</h3>
        <div class="metric">Todo: ${data.analytics.overview.todoTasks}</div>
        <div class="metric">In Progress: ${data.analytics.overview.inProgressTasks}</div>
        <div class="metric">Completed: ${data.analytics.overview.completedTasks}</div>
        
        <h3>Priority Breakdown</h3>
        <div class="metric">High: ${data.analytics.priority.high}</div>
        <div class="metric">Medium: ${data.analytics.priority.medium}</div>
        <div class="metric">Low: ${data.analytics.priority.low}</div>
    </div>

    <div class="section">
        <h2>Timeline (Last 30 Days)</h2>
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Tasks Created</th>
                    <th>Tasks Completed</th>
                    <th>Active Tasks</th>
                </tr>
            </thead>
            <tbody>
                ${data.timeline
									.map(
										(day) => `
                    <tr>
                        <td>${day.date}</td>
                        <td>${day.created}</td>
                        <td>${day.completed}</td>
                        <td>${day.active}</td>
                    </tr>
                `,
									)
									.join("")}
            </tbody>
        </table>
    </div>
</body>
</html>`;
	}

	async testPDFReportGeneration(): Promise<void> {
		await this.runTest("PDF report structure validation", async () => {
			const reportData = await this.generateReportData();

			// For this test, we'll validate the data structure that would be used for PDF generation
			// In a real implementation, you would use a PDF library like puppeteer or jsPDF

			const pdfData = {
				title: "Task Management Report",
				generatedAt: reportData.summary.generatedAt,
				sections: [
					{
						title: "Summary",
						content: [
							`Total Tasks: ${reportData.summary.totalTasks}`,
							`Completion Rate: ${reportData.summary.completionRate}%`,
							`Productivity Score: ${reportData.summary.productivityScore}`,
							`Average Completion Time: ${reportData.summary.avgCompletionTime}`,
						],
					},
					{
						title: "Analytics",
						subsections: [
							{
								title: "Task Status",
								data: {
									Todo: reportData.analytics.overview.todoTasks,
									"In Progress": reportData.analytics.overview.inProgressTasks,
									Completed: reportData.analytics.overview.completedTasks,
								},
							},
							{
								title: "Priority Distribution",
								data: {
									High: reportData.analytics.priority.high,
									Medium: reportData.analytics.priority.medium,
									Low: reportData.analytics.priority.low,
								},
							},
						],
					},
					{
						title: "Timeline Data",
						table: {
							headers: ["Date", "Created", "Completed", "Active"],
							rows: reportData.timeline.map((day) => [
								day.date,
								day.created.toString(),
								day.completed.toString(),
								day.active.toString(),
							]),
						},
					},
				],
			};

			// Validate PDF data structure
			if (!pdfData.title || !pdfData.generatedAt || !Array.isArray(pdfData.sections)) {
				throw new Error("PDF data structure invalid");
			}

			if (pdfData.sections.length === 0) {
				throw new Error("PDF should have at least one section");
			}

			// Validate each section
			pdfData.sections.forEach((section, index) => {
				if (!section.title) {
					throw new Error(`Section ${index} missing title`);
				}
			});

			// Validate timeline table
			const timelineSection = pdfData.sections.find((s) => s.title === "Timeline Data");
			if (!timelineSection || !timelineSection.table) {
				throw new Error("Timeline table missing from PDF data");
			}

			if (
				!Array.isArray(timelineSection.table.headers) ||
				timelineSection.table.headers.length !== 4
			) {
				throw new Error("Timeline table headers invalid");
			}

			if (!Array.isArray(timelineSection.table.rows) || timelineSection.table.rows.length !== 30) {
				throw new Error("Timeline table should have 30 rows");
			}
		});
	}

	async testReportAggregation(): Promise<void> {
		await this.runTest("Report data aggregation accuracy", async () => {
			const reportData = await this.generateReportData();

			// Verify aggregation calculations
			const tasks = reportData.tasks;
			const actualTotal = tasks.length;
			const actualCompleted = tasks.filter((t) => t.status === "done").length;
			const actualInProgress = tasks.filter((t) => t.status === "in-progress").length;
			const actualTodo = tasks.filter((t) => t.status === "todo").length;
			const actualHigh = tasks.filter((t) => t.priority === "high").length;
			const actualMedium = tasks.filter((t) => t.priority === "medium").length;
			const actualLow = tasks.filter((t) => t.priority === "low").length;

			// Check summary aggregation
			if (reportData.summary.totalTasks !== actualTotal) {
				throw new Error(
					`Total tasks aggregation mismatch: expected ${actualTotal}, got ${reportData.summary.totalTasks}`,
				);
			}

			// Check analytics aggregation
			if (reportData.analytics.overview.totalTasks !== actualTotal) {
				throw new Error(
					`Analytics total tasks mismatch: expected ${actualTotal}, got ${reportData.analytics.overview.totalTasks}`,
				);
			}

			if (reportData.analytics.overview.completedTasks !== actualCompleted) {
				throw new Error(
					`Completed tasks aggregation mismatch: expected ${actualCompleted}, got ${reportData.analytics.overview.completedTasks}`,
				);
			}

			if (reportData.analytics.overview.inProgressTasks !== actualInProgress) {
				throw new Error(
					`In-progress tasks aggregation mismatch: expected ${actualInProgress}, got ${reportData.analytics.overview.inProgressTasks}`,
				);
			}

			if (reportData.analytics.overview.todoTasks !== actualTodo) {
				throw new Error(
					`Todo tasks aggregation mismatch: expected ${actualTodo}, got ${reportData.analytics.overview.todoTasks}`,
				);
			}

			if (reportData.analytics.priority.high !== actualHigh) {
				throw new Error(
					`High priority aggregation mismatch: expected ${actualHigh}, got ${reportData.analytics.priority.high}`,
				);
			}

			if (reportData.analytics.priority.medium !== actualMedium) {
				throw new Error(
					`Medium priority aggregation mismatch: expected ${actualMedium}, got ${reportData.analytics.priority.medium}`,
				);
			}

			if (reportData.analytics.priority.low !== actualLow) {
				throw new Error(
					`Low priority aggregation mismatch: expected ${actualLow}, got ${reportData.analytics.priority.low}`,
				);
			}

			// Verify completion rate calculation
			const expectedCompletionRate =
				actualTotal > 0 ? Math.round((actualCompleted / actualTotal) * 100) : 0;
			if (reportData.analytics.overview.completionRate !== expectedCompletionRate) {
				throw new Error(
					`Completion rate calculation mismatch: expected ${expectedCompletionRate}%, got ${reportData.analytics.overview.completionRate}%`,
				);
			}
		});
	}

	async testReportFileOutput(): Promise<void> {
		await this.runTest("Report file output functionality", async () => {
			const reportData = await this.generateReportData();

			// Test JSON file output
			const jsonContent = JSON.stringify(reportData, null, 2);
			const jsonFilePath = "/tmp/test-report.json";

			try {
				fs.writeFileSync(jsonFilePath, jsonContent);

				if (!fs.existsSync(jsonFilePath)) {
					throw new Error("JSON report file was not created");
				}

				const fileContent = fs.readFileSync(jsonFilePath, "utf8");
				const parsedData = JSON.parse(fileContent);

				if (!parsedData.summary || !parsedData.analytics || !parsedData.timeline) {
					throw new Error("JSON report file content invalid");
				}

				// Cleanup
				fs.unlinkSync(jsonFilePath);
			} catch (error) {
				// Cleanup on error
				if (fs.existsSync(jsonFilePath)) {
					fs.unlinkSync(jsonFilePath);
				}
				throw error;
			}

			// Test CSV file output
			const csvHeaders = ["Date", "Tasks Created", "Tasks Completed", "Active Tasks"];
			const csvRows = reportData.timeline.map((day) =>
				[day.date, day.created, day.completed, day.active].join(","),
			);
			const csvContent = [csvHeaders.join(","), ...csvRows].join("\n");
			const csvFilePath = "/tmp/test-report.csv";

			try {
				fs.writeFileSync(csvFilePath, csvContent);

				if (!fs.existsSync(csvFilePath)) {
					throw new Error("CSV report file was not created");
				}

				const fileContent = fs.readFileSync(csvFilePath, "utf8");
				const lines = fileContent.split("\n");

				if (lines.length < 2) {
					throw new Error("CSV report file content invalid");
				}

				// Cleanup
				fs.unlinkSync(csvFilePath);
			} catch (error) {
				// Cleanup on error
				if (fs.existsSync(csvFilePath)) {
					fs.unlinkSync(csvFilePath);
				}
				throw error;
			}
		});
	}

	async testReportPerformance(): Promise<void> {
		await this.runTest("Report generation performance", async () => {
			const startTime = Date.now();

			// Generate multiple reports to test performance
			for (let i = 0; i < 10; i++) {
				await this.generateReportData();
			}

			const duration = Date.now() - startTime;
			const avgDuration = duration / 10;

			// Each report generation should take less than 100ms on average
			if (avgDuration > 100) {
				throw new Error(`Report generation too slow: ${avgDuration}ms average`);
			}

			console.log(`  Average report generation time: ${avgDuration}ms`);
		});
	}

	async runAllTests(): Promise<void> {
		console.log("🧪 Starting Report Generation Tests\n");

		await this.testJSONReportGeneration();
		await this.testCSVReportGeneration();
		await this.testHTMLReportGeneration();
		await this.testPDFReportGeneration();
		await this.testReportAggregation();
		await this.testReportFileOutput();
		await this.testReportPerformance();

		console.log("\n📊 Test Results:");
		const passed = this.results.filter((r) => r.passed).length;
		const failed = this.results.filter((r) => !r.passed).length;
		const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

		console.log(`Total: ${this.results.length} tests`);
		console.log(`Passed: ${passed} ✅`);
		console.log(`Failed: ${failed} ${failed > 0 ? "❌" : "✅"}`);
		console.log(`Duration: ${totalDuration}ms`);

		if (failed > 0) {
			console.log("\n❌ Failed Tests:");
			this.results
				.filter((r) => !r.passed)
				.forEach((r) => {
					console.log(`  - ${r.name}: ${r.error}`);
				});
			process.exit(1);
		} else {
			console.log("\n✅ All tests passed!");
		}
	}
}

// Run tests if this file is executed directly
if (require.main === module) {
	const tester = new ReportGeneratorTester();
	tester.runAllTests().catch((error) => {
		console.error("Test execution failed:", error);
		process.exit(1);
	});
}

export { ReportGeneratorTester };

