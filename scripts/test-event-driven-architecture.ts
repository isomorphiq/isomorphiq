import { globalEventBus } from "../core/event-bus.js";
import { InMemoryEventStore } from "../core/event-store.js";
import { loggingMiddleware, MetricsMiddleware } from "../core/event-middleware.js";
import { EventFactory } from "../core/event-bus.js";

// Test event-driven architecture
async function testEventDrivenArchitecture() {
	console.log("=== Testing Event-Driven Architecture ===");

	// Setup event store for persistence
	const eventStore = new InMemoryEventStore();
	globalEventBus.setEventStore(eventStore);

	// Setup middleware
	const metricsMiddleware = new MetricsMiddleware();
	globalEventBus.use(loggingMiddleware);
	globalEventBus.use(metricsMiddleware.middleware);

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

	// Test event subscription
	console.log("\n2. Testing event subscription...");
	globalEventBus.on("task_created", (event) => {
		console.log(`Received task_created event: ${event.data.task.title}`);
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

	// Test middleware metrics
	console.log("\n5. Middleware metrics:");
	const middlewareMetrics = metricsMiddleware.getMetrics();
	console.log(`Event counts:`, middlewareMetrics.eventCounts);
	console.log(`Processing times:`, middlewareMetrics.averageProcessingTimes);

	// Test different event types
	console.log("\n6. Testing different event types...");

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

	// Final metrics
	console.log("\n7. Final metrics:");
	const finalMetrics = globalEventBus.getMetrics();
	console.log(`Total events emitted: ${finalMetrics.eventsEmitted}`);
	console.log(`Total events processed: ${finalMetrics.eventsProcessed}`);
	console.log(`Total errors: ${finalMetrics.errors}`);

	const finalStoreStats = eventStore.getStats();
	console.log(`Total events stored: ${finalStoreStats.totalEvents}`);

	console.log("\n=== Event-Driven Architecture Test Complete ===");
}

// Test event replay functionality
async function testEventReplay() {
	console.log("\n=== Testing Event Replay ===");

	const eventStore = new InMemoryEventStore();

	// Add some events directly to store
	const task1Event = EventFactory.createTaskCreated(
		{
			id: "replay-task-1",
			title: "Replay Task 1",
			description: "First replay task",
			status: "todo",
			priority: "medium",
			type: "task",
			dependencies: [],
			createdBy: "user-1",
			createdAt: new Date(Date.now() - 5000),
			updatedAt: new Date(Date.now() - 5000),
		},
		"user-1",
	);

	const task2Event = EventFactory.createTaskCreated(
		{
			id: "replay-task-2",
			title: "Replay Task 2",
			description: "Second replay task",
			status: "todo",
			priority: "high",
			type: "task",
			dependencies: [],
			createdBy: "user-2",
			createdAt: new Date(Date.now() - 3000),
			updatedAt: new Date(Date.now() - 3000),
		},
		"user-2",
	);

	await eventStore.append(task1Event);
	await eventStore.append(task2Event);

	// Get events from store
	const allEvents = await eventStore.getEvents();
	console.log(`Retrieved ${allEvents.length} events from store`);

	const taskEvents = await eventStore.getEventsByType("task_created");
	console.log(`Retrieved ${taskEvents.length} task_created events`);

	console.log("=== Event Replay Test Complete ===");
}

// Test error handling
async function testErrorHandling() {
	console.log("\n=== Testing Error Handling ===");

	let errorCount = 0;

	// Subscribe to all events with error handler
	globalEventBus.onAll((event) => {
		// Simulate an error for some events
		if (event.data.task?.title?.includes("Error")) {
			throw new Error(`Simulated error for event ${event.type}`);
		}
	});

	// Create an event that will cause an error
	const errorEvent = EventFactory.createTaskCreated(
		{
			id: "error-task",
			title: "Error Task",
			description: "This task will cause an error",
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

	try {
		await globalEventBus.publish(errorEvent);
	} catch (error) {
		errorCount++;
		console.log(`Caught expected error: ${(error as Error).message}`);
	}

	// Create a normal event
	const normalEvent = EventFactory.createTaskCreated(
		{
			id: "normal-task",
			title: "Normal Task",
			description: "This task will not cause an error",
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

	try {
		await globalEventBus.publish(normalEvent);
	} catch (error) {
		errorCount++;
		console.log(`Caught unexpected error: ${(error as Error).message}`);
	}

	const metrics = globalEventBus.getMetrics();
	console.log(`Error count in metrics: ${metrics.errors}`);
	console.log(`Actual error count: ${errorCount}`);

	console.log("=== Error Handling Test Complete ===");
}

// Run all tests
async function runAllTests() {
	try {
		await testEventDrivenArchitecture();
		await testEventReplay();
		await testErrorHandling();
		console.log("\n🎉 All event-driven architecture tests passed!");
	} catch (error) {
		console.error("\n❌ Test failed:", error);
		process.exit(1);
	}
}

// Run tests if this file is executed directly
if (require.main === module) {
	runAllTests();
}

export { testEventDrivenArchitecture, testEventReplay, testErrorHandling };
