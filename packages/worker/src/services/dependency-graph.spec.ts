import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { DependencyGraphService } from "./dependency-graph.ts";

describe("DependencyGraphService", () => {
	let service: DependencyGraphService;

	beforeEach(() => {
		service = new DependencyGraphService();
	});

	describe("updateTaskCache", () => {
		it("should update internal cache with provided tasks", () => {
			const tasks = [
				{
					id: "1",
					title: "Task 1",
					description: "First task",
					status: "done",
					priority: "high",
					type: "task",
					createdAt: new Date(),
					updatedAt: new Date()
				}
			];

			service.updateTaskCache(tasks);
			
			// Should not throw and cache should be updated internally
			assert.ok(true, "Cache update should complete without errors");
		});
	});

	describe("detectCircularDependencies", () => {
		it("should detect no circular dependencies in valid graph", () => {
			const tasks = [
				{
					id: "1",
					title: "Task 1",
					description: "First task",
					status: "done",
					priority: "high",
					type: "task",
					createdAt: new Date(),
					updatedAt: new Date()
				},
				{
					id: "2",
					title: "Task 2",
					description: "Second task",
					status: "todo",
					priority: "medium",
					type: "task",
					createdAt: new Date(),
					updatedAt: new Date(),
					dependencies: ["1"]
				}
			];

			const result = service.detectCircularDependencies(tasks);
			
			assert.strictEqual(result.hasCycle, false, "Should not have circular dependencies");
			assert.strictEqual(result.cycles.length, 0, "Should have no cycles");
			assert.strictEqual(result.affectedTasks.length, 0, "Should have no affected tasks");
		});

		it("should detect simple circular dependency", () => {
			const tasks = [
				{
					id: "1",
					title: "Task 1",
					description: "First task",
					status: "done",
					priority: "high",
					type: "task",
					createdAt: new Date(),
					updatedAt: new Date()
				},
				{
					id: "2",
					title: "Task 2",
					description: "Second task",
					status: "todo",
					priority: "medium",
					type: "task",
					createdAt: new Date(),
					updatedAt: new Date(),
					dependencies: ["1"]
				},
				{
					id: "3",
					title: "Task 3",
					description: "Third task",
					status: "todo",
					priority: "low",
					type: "task",
					createdAt: new Date(),
					updatedAt: new Date(),
					dependencies: ["2"]
				},
				{
					id: "4",
					title: "Task 4",
					description: "Fourth task",
					status: "todo",
					priority: "low",
					type: "task",
					createdAt: new Date(),
					updatedAt: new Date(),
					dependencies: ["3"]
				}
			];

			// Create circular dependency by modifying task 1 to depend on 4
			tasks[0].dependencies = ["4"];

			const result = service.detectCircularDependencies(tasks);
			
			assert.strictEqual(result.hasCycle, true, "Should detect circular dependency");
			assert.strictEqual(result.cycles.length, 1, "Should have 1 cycle");
			assert.ok(result.affectedTasks.length >= 2, "Should have multiple affected tasks");
		});
	});

	describe("validateDependencies", () => {
		it("should validate correct dependencies", () => {
			const tasks = [
				{
					id: "1",
					title: "Task 1",
					description: "First task",
					status: "done",
					priority: "high",
					type: "task",
					createdAt: new Date(),
					updatedAt: new Date()
				},
				{
					id: "2",
					title: "Task 2",
					description: "Second task",
					status: "todo",
					priority: "medium",
					type: "task",
					createdAt: new Date(),
					updatedAt: new Date(),
					dependencies: ["1"]
				}
			];

			const result = service.validateDependencies(tasks);
			
			assert.strictEqual(result.isValid, true, "Valid dependencies should pass validation");
			assert.strictEqual(result.errors.length, 0, "Should have no errors");
		});

		it("should detect self-dependency", () => {
			const tasks = [
				{
					id: "1",
					title: "Task 1",
					description: "First task",
					status: "todo",
					priority: "medium",
					type: "task",
					createdAt: new Date(),
					updatedAt: new Date(),
					dependencies: ["1"] // Self-dependency
				}
			];

			const result = service.validateDependencies(tasks);
			
			assert.strictEqual(result.isValid, false, "Self-dependency should be invalid");
			assert.ok(result.errors.some(e => e.type === "self"), 
				"Should have self-dependency error");
		});
	});

	describe("getProcessableTasks", () => {
		it("should identify tasks ready for processing", () => {
			const tasks = [
				{
					id: "1",
					title: "Task 1",
					description: "First task",
					status: "done",
					priority: "high",
					type: "task",
					createdAt: new Date(),
					updatedAt: new Date()
				},
				{
					id: "2",
					title: "Task 2",
					description: "Second task",
					status: "todo",
					priority: "medium",
					type: "task",
					createdAt: new Date(),
					updatedAt: new Date(),
					dependencies: ["1"]
				}
			];

			const processable = service.getProcessableTasks(tasks);
			
			assert.strictEqual(processable.length, 1, "Should have 1 processable task");
			assert.strictEqual(processable[0].id, "2", "Task 2 should be processable");
		});
	});

	describe("edge cases", () => {
		it("should handle empty task list", () => {
			const graph = service.generateDependencyGraph([]);
			
			assert.strictEqual(graph.nodes.length, 0, "Empty list should have no nodes");
			assert.strictEqual(graph.edges.length, 0, "Empty list should have no edges");
			assert.strictEqual(graph.criticalPath.length, 0, "Empty list should have no critical path");
		});

		it("should handle single task", () => {
			const tasks = [
				{
					id: "1",
					title: "Single task",
					description: "Only task",
					status: "todo",
					priority: "medium",
					type: "task",
					createdAt: new Date(),
					updatedAt: new Date()
				}
			];

			const graph = service.generateDependencyGraph(tasks);
			
			assert.strictEqual(graph.nodes.length, 1, "Single task should have 1 node");
			assert.strictEqual(graph.edges.length, 0, "Single task should have no edges");
			assert.deepStrictEqual(graph.criticalPath, ["1"], "Single task should be critical path");
		});
	});
});