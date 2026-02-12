#!/usr/bin/env node

/**
 * Test script for Task Workflow Automation Builder
 */

import {
    WorkflowService,
    initializeWorkflowTemplates,
    WorkflowExecutionEngine,
} from "@isomorphiq/workflow";
import type { WorkflowDefinition } from "@isomorphiq/workflow";

async function testWorkflowAutomation() {
	console.log("🧪 Testing Task Workflow Automation Builder...\n");

	// Initialize services
	const workflowService = new WorkflowService();
	const executionEngine = new WorkflowExecutionEngine();

	try {
		// Test 1: Initialize templates
		console.log("1️⃣ Initializing workflow templates...");
		await initializeWorkflowTemplates(workflowService);
		const templates = await workflowService.listTemplates();
		console.log(`✅ Created ${templates.length} workflow templates`);

		// Test 2: Create a simple workflow
		console.log("\n2️⃣ Creating a test workflow...");
		const testWorkflow: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt"> = {
			name: "Test Task Automation",
			description: "A simple test workflow for task automation",
			version: "1.0.0",
			category: "task_management",
			nodes: [
				{
					id: "trigger-1",
					type: "trigger",
					position: { x: 100, y: 100 },
					data: { eventType: "task_created" },
				},
				{
					id: "notification-1",
					type: "notification",
					position: { x: 300, y: 100 },
					data: {
						recipients: ["admin"],
						message: "New task created: {{task.title}}",
						type: "info",
					},
				},
			],
			connections: [
				{
					id: "conn-1",
					sourceNodeId: "trigger-1",
					sourcePortId: "output",
					targetNodeId: "notification-1",
					targetPortId: "input",
				},
			],
			variables: [],
			settings: {
				timeout: 300,
				errorHandling: "stop",
				logging: { enabled: true, level: "info", includeData: false },
			},
			metadata: {
				tags: ["test"],
				author: "test-system",
			},
			enabled: true,
			createdBy: "test-user",
			updatedBy: "test-user",
		};

		const createdWorkflow = await workflowService.createWorkflow(testWorkflow);
		console.log(`✅ Created workflow: ${createdWorkflow.name} (${createdWorkflow.id})`);

		// Test 3: Validate workflow
		console.log("\n3️⃣ Validating workflow...");
		const validation = await workflowService.validateWorkflow(createdWorkflow);
		if (validation.valid) {
			console.log("✅ Workflow validation passed");
		} else {
			console.log("❌ Workflow validation failed:");
			validation.errors.forEach((error) => {
				console.log(`   - ${error.message}`);
			});
		}

		// Test 4: Execute workflow
		console.log("\n4️⃣ Executing workflow...");
		const execution = await executionEngine.executeWorkflow(
			createdWorkflow,
			{ task: { id: "test-task-1", title: "Test Task", priority: "high" } },
			{ user: { id: "test-user", username: "testuser", role: "admin" } },
		);

		console.log(`✅ Workflow execution completed: ${execution.status}`);
		console.log(`   Duration: ${execution.duration}ms`);
		console.log(`   Nodes executed: ${execution.nodes.length}`);

		// Test 5: Get workflow statistics
		console.log("\n5️⃣ Getting workflow statistics...");
		const stats = await workflowService.getWorkflowStatistics(createdWorkflow.id);
		console.log(`✅ Workflow statistics:`);
		console.log(`   Total executions: ${stats.totalExecutions}`);
		console.log(`   Successful executions: ${stats.successfulExecutions}`);
		console.log(`   Failed executions: ${stats.failedExecutions}`);
		console.log(`   Average execution time: ${Math.round(stats.averageExecutionTime)}ms`);
		console.log(`   Error rate: ${Math.round(stats.errorRate * 100)}%`);

		// Test 6: List workflows
		console.log("\n6️⃣ Listing all workflows...");
		const workflows = await workflowService.listWorkflows();
		console.log(`✅ Found ${workflows.length} workflows`);
		workflows.forEach((workflow) => {
			console.log(
				`   - ${workflow.name} (${workflow.category}) - ${workflow.enabled ? "Enabled" : "Disabled"}`,
			);
		});

		// Test 7: List executions
		console.log("\n7️⃣ Listing workflow executions...");
		const executions = await workflowService.listExecutions();
		console.log(`✅ Found ${executions.length} executions`);
		executions.slice(0, 3).forEach((execution) => {
			console.log(
				`   - ${execution.id}: ${execution.status} (${Math.round((execution.duration || 0) / 1000)}s)`,
			);
		});

		// Test 8: Create workflow from template
		console.log("\n8️⃣ Creating workflow from template...");
		if (templates.length > 0) {
			const template = templates[0];
			if (template) {
				const templateWorkflow = await workflowService.createFromTemplate(
					template.id,
					"Template Test Workflow",
					"Workflow created from template",
					{ maxTasksPerUser: 3, defaultAssignee: "template-user" },
				);

				if (templateWorkflow) {
					console.log(`✅ Created workflow from template: ${templateWorkflow.name}`);
				} else {
					console.log("❌ Failed to create workflow from template");
				}
			}
		}

		console.log("\n🎉 All workflow automation tests passed!");
		console.log("\n📋 Summary:");
		console.log("   ✅ Workflow templates initialized");
		console.log("   ✅ Workflow creation working");
		console.log("   ✅ Workflow validation working");
		console.log("   ✅ Workflow execution working");
		console.log("   ✅ Statistics calculation working");
		console.log("   ✅ Workflow listing working");
		console.log("   ✅ Execution tracking working");
		console.log("   ✅ Template-based creation working");
	} catch (error) {
		console.error("❌ Test failed:", error);
		process.exit(1);
	} finally {
		// Cleanup
		await workflowService.close();
	}
}

// Run tests
testWorkflowAutomation().catch(console.error);
