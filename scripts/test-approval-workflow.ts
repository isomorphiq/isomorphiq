import { ApprovalWorkflowService } from "../src/services/approval-workflow-service.js";
import {
	InMemoryApprovalWorkflowRepository,
	InMemoryTaskApprovalRepository,
	InMemoryApprovalTemplateRepository,
} from "../src/repositories/approval-workflow-repository.js";
import type {
	CreateApprovalWorkflowInput,
	StartTaskApprovalInput,
	ProcessApprovalInput,
} from "../src/core/approval-workflow.js";

async function testApprovalWorkflowSystem() {
	console.log("🧪 Testing Approval Workflow System...");

	// Initialize repositories
	const workflowRepo = new InMemoryApprovalWorkflowRepository();
	const approvalRepo = new InMemoryTaskApprovalRepository();
	const templateRepo = new InMemoryApprovalTemplateRepository();

	// Initialize service
	const approvalService = new ApprovalWorkflowService(workflowRepo, approvalRepo, templateRepo);

	try {
		// Test 1: Create a basic approval workflow
		console.log("\n📝 Test 1: Creating approval workflow...");
		const workflowInput: CreateApprovalWorkflowInput = {
			name: "Basic Task Approval",
			description: "Simple approval workflow for task completion",
			stages: [
				{
					name: "Manager Review",
					description: "Manager must approve the task",
					type: "sequential",
					approvers: [
						{
							type: "role",
							value: "manager",
							isRequired: true,
							canDelegate: true,
						},
					],
					isRequired: true,
					timeoutDays: 3,
				},
				{
					name: "Director Review",
					description: "Director final approval for high-value tasks",
					type: "sequential",
					approvers: [
						{
							type: "role",
							value: "director",
							isRequired: true,
							canDelegate: false,
						},
					],
					isRequired: false,
					timeoutDays: 5,
				},
			],
			rules: [
				{
					name: "Auto-start for high priority tasks",
					trigger: {
						type: "task_created",
					},
					conditions: [
						{
							field: "priority",
							operator: "equals",
							value: "high",
						},
					],
					actions: [
						{
							type: "start_approval",
							parameters: {
								workflowId: "auto",
							},
						},
					],
					isActive: true,
				},
			],
		};

		const workflowResult = await approvalService.workflow.create(workflowInput, "user-1");
		if (!workflowResult.success) {
			throw new Error(`Failed to create workflow: ${workflowResult.error?.message}`);
		}
		const workflow = workflowResult.data;
		console.log("✅ Workflow created:", workflow.name, workflow.id);

		// Test 2: Get all workflows
		console.log("\n📋 Test 2: Getting all workflows...");
		const allWorkflowsResult = await approvalService.workflow.getAll();
		if (!allWorkflowsResult.success) {
			throw new Error(`Failed to get workflows: ${allWorkflowsResult.error?.message}`);
		}
		console.log("✅ Retrieved workflows:", allWorkflowsResult.data.length);

		// Test 3: Start an approval process
		console.log("\n🚀 Test 3: Starting approval process...");
		const startApprovalInput: StartTaskApprovalInput = {
			taskId: "task-123",
			workflowId: workflow.id,
			requestedBy: "user-1",
			reason: "Task requires formal approval before completion",
			metadata: {
				priority: "high",
				category: "development",
			},
		};

		const approvalResult = await approvalService.approval.start(startApprovalInput);
		if (!approvalResult.success) {
			throw new Error(`Failed to start approval: ${approvalResult.error?.message}`);
		}
		const approval = approvalResult.data;
		console.log("✅ Approval started:", approval.id, "Status:", approval.status);

		// Test 4: Get pending approvals
		console.log("\n⏳ Test 4: Getting pending approvals...");
		const pendingResult = await approvalService.approval.getPending();
		if (!pendingResult.success) {
			throw new Error(`Failed to get pending approvals: ${pendingResult.error?.message}`);
		}
		console.log("✅ Pending approvals:", pendingResult.data.length);

		// Test 5: Process approval (first stage)
		console.log("\n✅ Test 5: Processing approval (Manager Review)...");
		const managerStage = approval.stages.find((s) => s.stageName === "Manager Review");
		if (!managerStage) {
			throw new Error("Manager Review stage not found");
		}

		// Find the actual approver ID from the stage
		const approverId = managerStage.approvers[0]?.approverId;
		if (!approverId) {
			throw new Error("No approver found in Manager Review stage");
		}

		const processInput: ProcessApprovalInput = {
			approvalId: approval.id,
			stageId: managerStage.stageId,
			approverId: approverId,
			action: "approve",
			comment: "Task looks good, approved for next stage",
		};

		const processResult = await approvalService.approval.process(processInput);
		if (!processResult.success) {
			throw new Error(`Failed to process approval: ${processResult.error?.message}`);
		}
		const updatedApproval = processResult.data;
		console.log(
			"✅ Approval processed:",
			updatedApproval.status,
			"Current stage:",
			updatedApproval.currentStage,
		);

		// Test 6: Process second stage
		console.log("\n✅ Test 6: Processing approval (Director Review)...");
		const directorStage = updatedApproval.stages.find((s) => s.stageName === "Director Review");
		if (!directorStage) {
			throw new Error("Director Review stage not found");
		}

		// Find the actual director approver ID
		const directorApproverId = directorStage.approvers[0]?.approverId;
		if (!directorApproverId) {
			throw new Error("No approver found in Director Review stage");
		}

		const directorProcessInput: ProcessApprovalInput = {
			approvalId: updatedApproval.id,
			stageId: directorStage.stageId,
			approverId: directorApproverId,
			action: "approve",
			comment: "Final approval granted",
		};

		const directorProcessResult = await approvalService.approval.process(directorProcessInput);
		if (!directorProcessResult.success) {
			throw new Error(
				`Failed to process director approval: ${directorProcessResult.error?.message}`,
			);
		}
		const finalApproval = directorProcessResult.data;
		console.log("✅ Final approval processed:", finalApproval.status);

		// Test 7: Get approval by task
		console.log("\n🔍 Test 7: Getting approval by task...");
		const byTaskResult = await approvalService.approval.getByTask("task-123");
		if (!byTaskResult.success) {
			throw new Error(`Failed to get approval by task: ${byTaskResult.error?.message}`);
		}
		console.log("✅ Approvals for task:", byTaskResult.data.length);

		// Test 8: Get approval by approver
		console.log("\n👥 Test 8: Getting approvals by approver...");
		const byApproverResult = await approvalService.approval.getByApprover("manager-1");
		if (!byApproverResult.success) {
			throw new Error(`Failed to get approvals by approver: ${byApproverResult.error?.message}`);
		}
		console.log("✅ Approvals for approver:", byApproverResult.data.length);

		// Test 9: Test rejection workflow
		console.log("\n❌ Test 9: Testing rejection workflow...");
		const rejectionWorkflowInput: CreateApprovalWorkflowInput = {
			name: "Rejection Test Workflow",
			description: "Workflow to test rejection functionality",
			stages: [
				{
					name: "Review Stage",
					description: "Single stage for testing rejection",
					type: "sequential",
					approvers: [
						{
							type: "user",
							value: "reviewer-1",
							isRequired: true,
							canDelegate: false,
						},
					],
					isRequired: true,
				},
			],
		};

		const rejectionWorkflowResult = await approvalService.workflow.create(
			rejectionWorkflowInput,
			"user-1",
		);
		if (!rejectionWorkflowResult.success) {
			throw new Error(
				`Failed to create rejection workflow: ${rejectionWorkflowResult.error?.message}`,
			);
		}
		const rejectionWorkflow = rejectionWorkflowResult.data;

		const rejectionStartInput: StartTaskApprovalInput = {
			taskId: "task-456",
			workflowId: rejectionWorkflow.id,
			requestedBy: "user-2",
			reason: "Testing rejection functionality",
		};

		const rejectionApprovalResult = await approvalService.approval.start(rejectionStartInput);
		if (!rejectionApprovalResult.success) {
			throw new Error(
				`Failed to start rejection approval: ${rejectionApprovalResult.error?.message}`,
			);
		}
		const rejectionApproval = rejectionApprovalResult.data;

		const rejectionProcessInput: ProcessApprovalInput = {
			approvalId: rejectionApproval.id,
			stageId: rejectionApproval.stages[0].stageId,
			approverId: "reviewer-1",
			action: "reject",
			comment: "Task does not meet requirements",
		};

		const rejectionProcessResult = await approvalService.approval.process(rejectionProcessInput);
		if (!rejectionProcessResult.success) {
			throw new Error(`Failed to process rejection: ${rejectionProcessResult.error?.message}`);
		}
		const rejectedApproval = rejectionProcessResult.data;
		console.log("✅ Rejection processed:", rejectedApproval.status);

		// Test 10: Get statistics
		console.log("\n📊 Test 10: Getting approval statistics...");
		const statsResult = await approvalService.stats.getStats();
		if (!statsResult.success) {
			throw new Error(`Failed to get stats: ${statsResult.error?.message}`);
		}
		const stats = statsResult.data;
		console.log("✅ Statistics:");
		console.log("   Total approvals:", stats.totalApprovals);
		console.log("   Pending approvals:", stats.pendingApprovals);
		console.log("   Approved today:", stats.approvedToday);
		console.log("   Rejected today:", stats.rejectedToday);
		console.log("   Average approval time:", Math.round(stats.averageApprovalTime), "hours");

		// Test 11: Test delegation
		console.log("\n🔄 Test 11: Testing delegation...");
		const delegationWorkflowInput: CreateApprovalWorkflowInput = {
			name: "Delegation Test Workflow",
			description: "Workflow to test delegation functionality",
			stages: [
				{
					name: "Delegable Review",
					description: "Stage that allows delegation",
					type: "sequential",
					approvers: [
						{
							type: "user",
							value: "manager-2",
							isRequired: true,
							canDelegate: true,
						},
					],
					isRequired: true,
				},
			],
		};

		const delegationWorkflowResult = await approvalService.workflow.create(
			delegationWorkflowInput,
			"user-1",
		);
		if (!delegationWorkflowResult.success) {
			throw new Error(
				`Failed to create delegation workflow: ${delegationWorkflowResult.error?.message}`,
			);
		}
		const delegationWorkflow = delegationWorkflowResult.data;

		const delegationStartInput: StartTaskApprovalInput = {
			taskId: "task-789",
			workflowId: delegationWorkflow.id,
			requestedBy: "user-3",
			reason: "Testing delegation functionality",
		};

		const delegationApprovalResult = await approvalService.approval.start(delegationStartInput);
		if (!delegationApprovalResult.success) {
			throw new Error(
				`Failed to start delegation approval: ${delegationApprovalResult.error?.message}`,
			);
		}
		const delegationApproval = delegationApprovalResult.data;

		const delegationResult = await approvalService.approval.delegate(
			delegationApproval.id,
			delegationApproval.stages[0].stageId,
			"manager-2",
			"backup-manager-1",
		);
		if (!delegationResult.success) {
			throw new Error(`Failed to delegate: ${delegationResult.error?.message}`);
		}
		console.log("✅ Delegation successful");

		// Test 12: Test escalation
		console.log("\n⬆️ Test 12: Testing escalation...");
		const escalationResult = await approvalService.approval.escalate(
			delegationApproval.id,
			delegationApproval.stages[0].stageId,
			"manager-2",
			"Urgent: needs immediate attention",
		);
		if (!escalationResult.success) {
			throw new Error(`Failed to escalate: ${escalationResult.error?.message}`);
		}
		console.log("✅ Escalation successful");

		// Test 13: Test cancellation
		console.log("\n🚫 Test 13: Testing cancellation...");
		const cancellationWorkflowInput: CreateApprovalWorkflowInput = {
			name: "Cancellation Test Workflow",
			description: "Workflow to test cancellation",
			stages: [
				{
					name: "Cancellable Review",
					description: "Stage for testing cancellation",
					type: "sequential",
					approvers: [
						{
							type: "user",
							value: "reviewer-2",
							isRequired: true,
							canDelegate: false,
						},
					],
					isRequired: true,
				},
			],
		};

		const cancellationWorkflowResult = await approvalService.workflow.create(
			cancellationWorkflowInput,
			"user-1",
		);
		if (!cancellationWorkflowResult.success) {
			throw new Error(
				`Failed to create cancellation workflow: ${cancellationWorkflowResult.error?.message}`,
			);
		}
		const cancellationWorkflow = cancellationWorkflowResult.data;

		const cancellationStartInput: StartTaskApprovalInput = {
			taskId: "task-999",
			workflowId: cancellationWorkflow.id,
			requestedBy: "user-4",
			reason: "Testing cancellation functionality",
		};

		const cancellationApprovalResult = await approvalService.approval.start(cancellationStartInput);
		if (!cancellationApprovalResult.success) {
			throw new Error(
				`Failed to start cancellation approval: ${cancellationApprovalResult.error?.message}`,
			);
		}
		const cancellationApproval = cancellationApprovalResult.data;

		const cancelResult = await approvalService.approval.cancel(
			cancellationApproval.id,
			"user-4",
			"No longer needed",
		);
		if (!cancelResult.success) {
			throw new Error(`Failed to cancel: ${cancelResult.error?.message}`);
		}
		console.log("✅ Cancellation successful");

		// Test 14: Test parallel approval
		console.log("\n🔀 Test 14: Testing parallel approval...");
		const parallelWorkflowInput: CreateApprovalWorkflowInput = {
			name: "Parallel Approval Workflow",
			description: "Workflow with parallel approval stage",
			stages: [
				{
					name: "Parallel Review",
					description: "Multiple approvers can approve in parallel",
					type: "parallel",
					approvers: [
						{
							type: "user",
							value: "reviewer-3",
							isRequired: true,
							canDelegate: false,
						},
						{
							type: "user",
							value: "reviewer-4",
							isRequired: true,
							canDelegate: false,
						},
					],
					isRequired: true,
				},
			],
		};

		const parallelWorkflowResult = await approvalService.workflow.create(
			parallelWorkflowInput,
			"user-1",
		);
		if (!parallelWorkflowResult.success) {
			throw new Error(
				`Failed to create parallel workflow: ${parallelWorkflowResult.error?.message}`,
			);
		}
		const parallelWorkflow = parallelWorkflowResult.data;

		const parallelStartInput: StartTaskApprovalInput = {
			taskId: "task-parallel",
			workflowId: parallelWorkflow.id,
			requestedBy: "user-5",
			reason: "Testing parallel approval",
		};

		const parallelApprovalResult = await approvalService.approval.start(parallelStartInput);
		if (!parallelApprovalResult.success) {
			throw new Error(
				`Failed to start parallel approval: ${parallelApprovalResult.error?.message}`,
			);
		}
		const parallelApproval = parallelApprovalResult.data;

		// First approver approves
		const parallelProcess1Input: ProcessApprovalInput = {
			approvalId: parallelApproval.id,
			stageId: parallelApproval.stages[0].stageId,
			approverId: "reviewer-3",
			action: "approve",
			comment: "Approved from my side",
		};

		const parallelProcess1Result = await approvalService.approval.process(parallelProcess1Input);
		if (!parallelProcess1Result.success) {
			throw new Error(
				`Failed to process parallel approval 1: ${parallelProcess1Result.error?.message}`,
			);
		}

		// Second approver approves
		const parallelProcess2Input: ProcessApprovalInput = {
			approvalId: parallelApproval.id,
			stageId: parallelApproval.stages[0].stageId,
			approverId: "reviewer-4",
			action: "approve",
			comment: "Also approved",
		};

		const parallelProcess2Result = await approvalService.approval.process(parallelProcess2Input);
		if (!parallelProcess2Result.success) {
			throw new Error(
				`Failed to process parallel approval 2: ${parallelProcess2Result.error?.message}`,
			);
		}
		console.log("✅ Parallel approval completed");

		console.log("\n🎉 All approval workflow tests passed!");
		console.log("\n📈 Final Statistics:");
		const finalStatsResult = await approvalService.stats.getStats();
		if (finalStatsResult.success) {
			const finalStats = finalStatsResult.data;
			console.log("   Total workflows created:", allWorkflowsResult.data.length);
			console.log("   Total approvals processed:", finalStats.totalApprovals);
			console.log("   Pending approvals:", finalStats.pendingApprovals);
			console.log("   Approved today:", finalStats.approvedToday);
			console.log("   Rejected today:", finalStats.rejectedToday);
			console.log("   Average approval time:", Math.round(finalStats.averageApprovalTime), "hours");
			console.log("   Timeout rate:", finalStats.timeoutRate.toFixed(1), "%");
			console.log("   Escalation rate:", finalStats.escalationRate.toFixed(1), "%");
		}
	} catch (error) {
		console.error("❌ Approval workflow test failed:", error);
		throw error;
	}
}

// Run the test
if (require.main === module) {
	testApprovalWorkflowSystem()
		.then(() => {
			console.log("\n✅ Approval workflow system test completed successfully");
			process.exit(0);
		})
		.catch((error) => {
			console.error("\n❌ Approval workflow system test failed:", error);
			process.exit(1);
		});
}

export { testApprovalWorkflowSystem };
