// Mock task data for UI testing and development

interface MockTask {
	id: string;
	title: string;
	description: string;
	status: "todo" | "in-progress" | "done" | "failed" | "cancelled";
	priority: "high" | "medium" | "low";
	createdAt: Date;
	updatedAt: Date;
	createdBy?: string;
	assignedTo?: string;
	collaborators?: string[];
	watchers?: string[];
	type?: string;
	dependencies?: string[];
}

// Mock task data for UI testing and development
export const mockTasks: MockTask[] = [
	{
		id: "task-001",
		title: "Setup project repository",
		description: "Initialize Git repository with proper structure and README",
		status: "done",
		priority: "high",
		createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
		updatedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), // 6 days ago
		createdBy: "alice",
		assignedTo: "alice"
	},
	{
		id: "task-002", 
		title: "Configure development environment",
		description: "Set up Docker containers and development scripts",
		status: "done",
		priority: "high",
		createdAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), // 6 days ago
		updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
		createdBy: "alice",
		assignedTo: "bob"
	},
	{
		id: "task-003",
		title: "Implement authentication service",
		description: "Create user authentication and authorization system with JWT tokens",
		status: "in-progress",
		priority: "high",
		createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
		updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
		createdBy: "alice",
		assignedTo: "charlie",
		dependencies: ["task-001", "task-002"]
	},
	{
		id: "task-004",
		title: "Design database schema",
		description: "Create ERD and SQL scripts for main application database",
		status: "done",
		priority: "medium",
		createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
		updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
		createdBy: "bob",
		assignedTo: "bob"
	},
	{
		id: "task-005",
		title: "Implement REST API endpoints",
		description: "Create CRUD operations for all major entities",
		status: "in-progress",
		priority: "high",
		createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
		updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
		createdBy: "alice",
		assignedTo: "charlie",
		dependencies: ["task-003", "task-004"]
	},
	{
		id: "task-006",
		title: "Create frontend components",
		description: "Develop reusable React components for application",
		status: "todo",
		priority: "medium",
		createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
		updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
		createdBy: "diana",
		assignedTo: "diana"
	},
	{
		id: "task-007",
		title: "Setup CI/CD pipeline",
		description: "Configure GitHub Actions for automated testing and deployment",
		status: "todo",
		priority: "medium",
		createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
		updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
		createdBy: "bob",
		assignedTo: "eve"
	},
	{
		id: "task-008",
		title: "Write unit tests",
		description: "Create comprehensive unit tests for all services",
		status: "todo",
		priority: "low",
		createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
		updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
		createdBy: "alice",
		assignedTo: "eve",
		dependencies: ["task-005"]
	},
	{
		id: "task-009",
		title: "Performance optimization",
		description: "Optimize database queries and API response times",
		status: "todo",
		priority: "low",
		createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
		updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
		createdBy: "charlie",
		assignedTo: "charlie",
		dependencies: ["task-005", "task-008"]
	},
	{
		id: "task-010",
		title: "Create user documentation",
		description: "Write user guides and API documentation",
		status: "todo",
		priority: "low",
		createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
		updatedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
		createdBy: "diana",
		assignedTo: "diana",
		dependencies: ["task-006"]
	}
];

// Additional mock data for stress testing
export const generateLargeMockDataset = (count: number = 100): MockTask[] => {
	const tasks: MockTask[] = [];
	const statuses: MockTask["status"][] = ["todo", "in-progress", "done", "failed", "cancelled"];
	const priorities: MockTask["priority"][] = ["high", "medium", "low"];
	const users = ["alice", "bob", "charlie", "diana", "eve"];

	for (let i = 1; i <= count; i++) {
		const daysAgo = Math.floor(Math.random() * 30);
		const status = statuses[Math.floor(Math.random() * statuses.length)];
		const priority = priorities[Math.floor(Math.random() * priorities.length)];
		const createdBy = users[Math.floor(Math.random() * users.length)];
		const assignedTo = users[Math.floor(Math.random() * users.length)];

		tasks.push({
			id: `bulk-task-${i.toString().padStart(3, '0')}`,
			title: `Bulk Task ${i}: ${getRandomTaskTitle()}`,
			description: `This is a generated task ${i} for testing dashboard performance with large datasets. ${getRandomDescription()}`,
			status,
			priority,
			createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
			updatedAt: new Date(Date.now() - Math.floor(Math.random() * daysAgo) * 24 * 60 * 60 * 1000),
			createdBy,
			assignedTo,
			dependencies: Math.random() > 0.7 ? generateRandomDependencies(tasks, i) : undefined
		});
	}

	return tasks;
};

// Helper functions for generating mock data
function getRandomTaskTitle(): string {
	const titles = [
		"API Development",
		"Database Migration", 
		"UI Component Creation",
		"Bug Fix",
		"Performance Optimization",
		"Security Update",
		"Documentation",
		"Testing",
		"Code Review",
		"Deployment",
		"Configuration",
		"Research",
		"Analysis",
		"Refactoring",
		"Integration"
	];
	return titles[Math.floor(Math.random() * titles.length)];
}

function getRandomDescription(): string {
	const descriptions = [
		"This task involves implementing critical functionality for the application.",
		"Please ensure all requirements are met before marking as complete.",
		"Review the associated documentation for detailed specifications.",
		"Coordinate with team members for dependency resolution.",
		"Test thoroughly in all environments before deployment.",
		"Follow coding standards and best practices.",
		"Update relevant documentation upon completion."
	];
	return descriptions[Math.floor(Math.random() * descriptions.length)];
}

function generateRandomDependencies(existingTasks: MockTask[], _currentIndex: number): string[] {
	if (existingTasks.length === 0) return [];
	
	const dependencyCount = Math.floor(Math.random() * 3) + 1; // 1-3 dependencies
	const dependencies: string[] = [];
	
	for (let i = 0; i < dependencyCount; i++) {
		const randomIndex = Math.floor(Math.random() * Math.min(existingTasks.length, 10));
		if (randomIndex < existingTasks.length) {
			dependencies.push(existingTasks[randomIndex].id);
		}
	}
	
	return [...new Set(dependencies)]; // Remove duplicates
}

// Mock data for real-time updates testing
export const mockRealTimeUpdates = {
	// Simulate task status changes
	generateStatusChange: (taskId: string, oldStatus: MockTask["status"], newStatus: MockTask["status"]): any => ({
		type: "task_status_changed",
		data: {
			taskId,
			oldStatus,
			newStatus,
			timestamp: new Date().toISOString(),
			task: mockTasks.find(t => t.id === taskId)
		}
	}),

	// Simulate task creation
	generateTaskCreation: (taskData: Partial<MockTask>): any => ({
		type: "task_created",
		data: {
			id: `new-task-${Date.now()}`,
			title: taskData.title || "New Task",
			description: taskData.description || "Automatically generated task",
			status: "todo" as MockTask["status"],
			priority: taskData.priority || "medium" as MockTask["priority"],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			createdBy: taskData.createdBy || "system",
			assignedTo: taskData.assignedTo,
			dependencies: taskData.dependencies
		}
	}),

	// Simulate task priority changes
	generatePriorityChange: (taskId: string, oldPriority: MockTask["priority"], newPriority: MockTask["priority"]): any => ({
		type: "task_priority_changed",
		data: {
			taskId,
			oldPriority,
			newPriority,
			timestamp: new Date().toISOString(),
			task: mockTasks.find(t => t.id === taskId)
		}
	})
};

// Utility functions for testing
export const mockUtils = {
	getTasksByStatus: (status: MockTask["status"]) => mockTasks.filter(t => t.status === status),
	getTasksByPriority: (priority: MockTask["priority"]) => mockTasks.filter(t => t.priority === priority),
	getTasksByAssignee: (assignee: string) => mockTasks.filter(t => t.assignedTo === assignee),
	getActiveTasks: () => mockTasks.filter(t => t.status === "todo" || t.status === "in-progress"),
	getRecentTasks: (hours: number = 24) => {
		const cutoff = Date.now() - (hours * 60 * 60 * 1000);
		return mockTasks.filter(t => new Date(t.updatedAt).getTime() >= cutoff);
	},
	getHighPriorityTasks: () => mockTasks.filter(t => t.priority === "high" && t.status !== "done" && t.status !== "cancelled"),
	getTasksWithDependencies: () => mockTasks.filter(t => t.dependencies && t.dependencies.length > 0)
};