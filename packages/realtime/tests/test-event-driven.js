// Simple test for event-driven architecture
import {
    globalEventBus,
    InMemoryEventStore,
    loggingMiddleware,
    EventFactory,
} from "@isomorphiq/core";

async function testEventDrivenArchitecture() {
	console.log("=== Testing Event-Driven Architecture ===");

	try {
		// Setup event store for persistence
		const eventStore = new InMemoryEventStore();
		globalEventBus.setEventStore(eventStore);

		// Setup middleware
		globalEventBus.use(loggingMiddleware);

		// Test event creation and publishing
		console.log("\n1. Testing task creation event...");
		const taskCreatedEvent = EventFactory.createTaskCreated(
			{
				id: "task-1",
				title: "Test Task",
				description: "This is a test task",
				status: "todo",
				priority: "medium",
				type: "task",
				dependencies: [],
				createdBy: "user-1",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			"user-1",
		);

		await globalEventBus.publish(taskCreatedEvent);
		console.log("✅ Task creation event published successfully");

		// Test event subscription
		console.log("\n2. Testing event subscription...");
		let eventReceived = false;
		
		globalEventBus.on("task_created", (event) => {
			console.log(`✅ Received task_created event: ${event.data.task.title}`);
			eventReceived = true;
		});

		// Publish another event to test subscription
		const anotherTaskEvent = EventFactory.createTaskCreated(
			{
				id: "task-2",
				title: "Another Test Task",
				description: "This is another test task",
				status: "todo",
				priority: "high",
				type: "task",
				dependencies: [],
				createdBy: "user-2",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			"user-2",
		);

		await globalEventBus.publish(anotherTaskEvent);

		// Wait a bit for event processing
		await new Promise(resolve => setTimeout(resolve, 100));

		if (eventReceived) {
			console.log("✅ Event subscription working correctly");
		} else {
			console.log("❌ Event subscription failed");
		}

		// Test event metrics
		console.log("\n3. Event bus metrics:");
		const metrics = globalEventBus.getMetrics();
		console.log(`Events emitted: ${metrics.eventsEmitted}`);
		console.log(`Events processed: ${metrics.eventsProcessed}`);
		console.log(`Average processing time: ${metrics.averageProcessingTime}ms`);
		console.log(`Active listeners: ${metrics.listenerCount}`);

		// Test event store
		console.log("\n4. Event store statistics:");
		const storeStats = eventStore.getStats();
		console.log(`Total events: ${storeStats.totalEvents}`);
		console.log(`Event types:`, storeStats.eventTypes);

		// Test different event types
		console.log("\n5. Testing different event types...");

		// Task status change
		const statusChangeEvent = EventFactory.createTaskStatusChanged(
			"task-1",
			"todo",
			"in-progress",
			{
				id: "task-1",
				title: "Test Task",
				description: "This is a test task",
				status: "in-progress",
				priority: "medium",
				type: "task",
				dependencies: [],
				createdBy: "user-1",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			"user-1",
		);

		await globalEventBus.publish(statusChangeEvent);
		console.log("✅ Status change event published");

		// Task priority change
		const priorityChangeEvent = EventFactory.createTaskPriorityChanged(
			"task-1",
			"medium",
			"high",
			{
				id: "task-1",
				title: "Test Task",
				description: "This is a test task",
				status: "in-progress",
				priority: "high",
				type: "task",
				dependencies: [],
				createdBy: "user-1",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			"user-1",
		);

		await globalEventBus.publish(priorityChangeEvent);
		console.log("✅ Priority change event published");

		// Task assignment
		const assignmentEvent = EventFactory.createTaskAssigned(
			{
				id: "task-1",
				title: "Test Task",
				description: "This is a test task",
				status: "in-progress",
				priority: "high",
				type: "task",
				dependencies: [],
				createdBy: "user-1",
				assignedTo: "user-2",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			"user-2",
			"user-1",
		);

		await globalEventBus.publish(assignmentEvent);
		console.log("✅ Assignment event published");

		// Final metrics
		console.log("\n6. Final metrics:");
		const finalMetrics = globalEventBus.getMetrics();
		console.log(`Total events emitted: ${finalMetrics.eventsEmitted}`);
		console.log(`Total events processed: ${finalMetrics.eventsProcessed}`);
		console.log(`Total errors: ${finalMetrics.errors}`);

		const finalStoreStats = eventStore.getStats();
		console.log(`Total events stored: ${finalStoreStats.totalEvents}`);

		console.log("\n🎉 Event-Driven Architecture Test Complete ===");
		return true;

	} catch (error) {
		console.error("❌ Test failed:", error);
		return false;
	}
}

// Run the test
testEventDrivenArchitecture().then(success => {
	if (success) {
		console.log("\n✅ All event-driven architecture tests passed!");
		process.exit(0);
	} else {
		console.log("\n❌ Event-driven architecture tests failed!");
		process.exit(1);
	}
}).catch(error => {
	console.error("\n💥 Unexpected error:", error);
	process.exit(1);
});
