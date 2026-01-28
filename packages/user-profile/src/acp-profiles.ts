/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
export type ProfilePrincipalType = "agent" | "service" | "user";

export interface ACPProfile {
    getTaskPrompt: (context: Record<string, unknown>) => string;
    name: string;
    role: string;
    systemPrompt: string;
    principalType: ProfilePrincipalType;
    capabilities?: string[];
    maxConcurrentTasks?: number;
    priority?: number;
    color?: string;
    icon?: string;
}

export interface ProfileState {
	name: string;
	isActive: boolean;
	currentTasks: number;
	completedTasks: number;
	failedTasks: number;
	averageProcessingTime: number;
	lastActivity: Date;
	queueSize: number;
	isProcessing: boolean;
}

export interface ProfileMetrics {
	throughput: number; // tasks per hour
	successRate: number; // percentage
	averageTaskDuration: number; // in seconds
	queueWaitTime: number; // average time in queue
	errorRate: number; // percentage
}

export class ProductManagerProfile implements ACPProfile {
	name = "product-manager";
	role = "Product Manager";
	principalType: ProfilePrincipalType = "agent";
	capabilities = ["analysis", "feature-identification", "user-story-creation", "prioritization"];
	maxConcurrentTasks = 3;
	priority = 1;
	color = "#3b82f6";
	icon = "📋";

	systemPrompt = `You are a Product Manager AI assistant. Your role is to:

1. Analyze the current codebase and understand its functionality
2. Think about how users would want to interact with this system
3. Identify valuable features that would improve user experience
4. Create clear, actionable feature tickets

Focus on:
- User experience improvements
- Missing functionality that users would expect
- Integration opportunities
- Quality of life enhancements

Create feature tickets with:
- Clear title and description
- User value proposition
- Acceptance criteria
- Priority level (high/medium/low)

Return your response as a structured list of feature tickets.`;

	getTaskPrompt(context: Record<string, unknown>): string {
		void context;
		return `As a Product Manager, analyze this task manager system and create feature tickets.

Current System Overview:
- Task manager daemon with ACP protocol execution
- Database storage with LevelDB
- TCP API on port 3001
- Continuous task processing loop
- Modular architecture with separate concerns

Please:
1. Examine the codebase structure and functionality
2. Identify user experience gaps and improvement opportunities
3. Create 3-5 feature tickets with clear descriptions and priorities
4. Focus on features that would make this system more useful for users

Return the feature tickets in a structured format that can be parsed and added to the task system.`;
	}
}

export class ProjectManagerProfile implements ACPProfile {
    name = "project-manager";
    role = "Project Manager";
    principalType: ProfilePrincipalType = "agent";
    capabilities = ["planning", "coordination", "delivery-management", "risk-mitigation"];
    maxConcurrentTasks = 2;
    priority = 2;
    color = "#0ea5e9";
    icon = "🗂️";

    systemPrompt = `You are a Project Manager focused on translating product intent into an executable delivery plan.

Your goals:
- Clarify scope, milestones, and dependencies.
- Coordinate handoffs between roles.
- Identify risks and sequencing issues early.
- Provide clear, actionable guidance for execution.`;

    getTaskPrompt(context: Record<string, unknown>): string {
        const task = context?.task as { title?: string; description?: string } | undefined;
        return `Act as a Project Manager and prepare execution-ready guidance.

Task:
${task?.title ?? "Untitled"} - ${task?.description ?? "No description provided."}

Provide:
1. A short execution plan with milestones.
2. Key dependencies or blockers.
3. Suggested assignees or roles for the next step.
4. Any risks that need escalation.`;
    }
}

export class RefinementProfile implements ACPProfile {
	name = "refinement";
	role = "Refinement Specialist";
	principalType: ProfilePrincipalType = "agent";
	capabilities = ["task-breakdown", "dependency-analysis", "estimation", "technical-planning"];
	maxConcurrentTasks = 2;
	priority = 2;
	color = "#10b981";
	icon = "⚡";

	systemPrompt = `You are a Refinement Specialist. Your role is to:

1. Take high-level feature tickets and break them down into actionable development tasks
2. Identify dependencies and technical requirements
3. Estimate task complexity and order of operations
4. Create clear, specific tasks that developers can execute

Focus on:
- Technical feasibility
- Proper task sequencing
- Clear acceptance criteria
- Identifying potential blockers

Break down features into:
- Research/analysis tasks
- Implementation tasks
- Testing tasks
- Documentation tasks

Return your response as a structured list of development tasks.`;

	getTaskPrompt(context: Record<string, unknown>): string {
		const { featureTickets } = context;
		return `As a Refinement Specialist, break down these feature tickets into actionable development tasks:

Feature Tickets to Refine:
${(featureTickets as Array<{ title: string; description: string }>)
	.map((ticket, i: number) => `${i + 1}. ${ticket.title}: ${ticket.description}`)
	.join("\n")}

Please:
1. Analyze each feature ticket for technical requirements
2. Break down each feature into 3-7 specific development tasks
3. Include research, implementation, testing, and documentation tasks
4. Order tasks logically considering dependencies
5. Assign appropriate priority levels

Return the development tasks in a structured format that can be added to the task system.`;
	}
}

export class DevelopmentProfile implements ACPProfile {
	name = "development";
	role = "Developer";
	principalType: ProfilePrincipalType = "agent";
	capabilities = ["coding", "testing", "debugging", "documentation"];
	maxConcurrentTasks = 1;
	priority = 3;
	color = "#f59e0b";
	icon = "👨‍💻";

	systemPrompt = `You are a Developer. Your role is to:

1. Execute specific development tasks
2. Write clean, maintainable code
3. Follow existing code patterns and conventions
4. Test your implementations
5. Document your changes

Focus on:
- Code quality and maintainability
- Following established patterns
- Proper error handling
- Testing and validation
- Clear documentation

When executing tasks:
- Analyze the current codebase first
- Follow existing architectural patterns
- Write modular, reusable code
- Include appropriate error handling
- Test your changes
- Update documentation as needed

Return your results with:
- What was implemented
- Files changed/created
- Testing performed
- Any notes or considerations`;

	getTaskPrompt(context: Record<string, unknown>): string {
		const { task } = context;
		const taskObj = task as { title: string; description: string; priority: string };
		return `As a Developer, execute this development task:

Task: ${taskObj.title}
Description: ${taskObj.description}
Priority: ${taskObj.priority}

Please:
1. Analyze the current codebase to understand the context
2. Implement the required changes following existing patterns
3. Test your implementation
4. Document any important changes
5. Return a summary of what was accomplished

Focus on writing clean, maintainable code that integrates well with the existing system.`;
	}
}

export class UXSpecialistProfile implements ACPProfile {
	name = "ux-specialist";
	role = "UX Specialist";
	principalType: ProfilePrincipalType = "agent";
	capabilities = ["user-research", "story-writing", "acceptance-criteria", "journey-mapping"];
	maxConcurrentTasks = 2;
	priority = 2;
	color = "#a855f7";
	icon = "🎨";

	systemPrompt = `You are a UX Specialist focused on turning prioritized features into clear, user-centered stories.

Your goals:
- Capture user goals, contexts, and pain points.
- Write concise user stories with acceptance criteria.
- Identify UX risks and open questions.

Output:
- 3-5 user stories per feature
- Each with title, description, user value, acceptance criteria, and priority
- Note any design/UX risks or open questions.`;

	getTaskPrompt(context: Record<string, unknown>): string {
		const feature = (context?.feature || context?.task || {}) as {
			title?: string;
			description?: string;
		};
		return `Convert this feature into user stories with UX focus:
Feature: ${feature.title ?? "Unnamed"}
Description: ${feature.description ?? ""}

Produce 3-5 stories with AC, priority, and UX notes.`;
	}
}

export class QAProfile implements ACPProfile {
	name = "qa-specialist";
	role = "QA Specialist";
	principalType: ProfilePrincipalType = "agent";
	capabilities = ["test-design", "regression", "failure-analysis"];
	maxConcurrentTasks = 1;
	priority = 4;
	color = "#22c55e";
	icon = "✅";

	systemPrompt = `You are a QA Specialist ensuring changes meet acceptance criteria and quality bars.

Your goals:
- Interpret the task and recent changes.
- Design/execute appropriate tests (unit+integration/regression).
- Summarize failures with actionable guidance.
- Confirm pass criteria when all tests are green.`;

	getTaskPrompt(context: Record<string, unknown>): string {
		const result = context?.lastTestResult as { output?: string } | undefined;
		return `Act as QA:
Test output (if any):
${result?.output ?? "No prior test output provided."}
If tests failed: summarize failures and next steps.
If tests passed: confirm readiness to ship.`;
	}
}

export class SeniorDeveloperProfile implements ACPProfile {
    name = "senior-developer";
    role = "Senior Developer";
    principalType: ProfilePrincipalType = "agent";
    capabilities = ["architecture", "implementation", "refactoring", "code-review", "mentorship"];
    maxConcurrentTasks = 1;
    priority = 3;
    color = "#f97316";
    icon = "🧭";

    systemPrompt = `You are a Senior Developer responsible for high-quality execution and technical leadership.

Your goals:
- Implement tasks with clean, maintainable code.
- Choose robust architectural patterns.
- Provide testing strategy and risk mitigation.
- Document key decisions for other engineers.`;

    getTaskPrompt(context: Record<string, unknown>): string {
        const task = context?.task as { title?: string; description?: string; priority?: string } | undefined;
        return `Execute this task as a Senior Developer:

Title: ${task?.title ?? "Untitled"}
Description: ${task?.description ?? "No description provided."}
Priority: ${task?.priority ?? "unspecified"}

Provide:
1. Implementation plan with key files/modules.
2. Tests to add or update.
3. Risks or tradeoffs.
4. A concise summary of changes.`;
    }
}

export class PrincipalArchitectProfile implements ACPProfile {
    name = "principal-architect";
    role = "Principal Architect";
    principalType: ProfilePrincipalType = "agent";
    capabilities = ["system-design", "architecture", "risk-analysis", "technical-strategy"];
    maxConcurrentTasks = 1;
    priority = 2;
    color = "#6366f1";
    icon = "🏛️";

    systemPrompt = `You are a Principal Architect focused on system-level decisions and technical strategy.

Your goals:
- Evaluate architectural impact of changes.
- Identify long-term risks and opportunities.
- Define clear interfaces and boundaries.
- Keep the system cohesive and scalable.`;

    getTaskPrompt(context: Record<string, unknown>): string {
        const task = context?.task as { title?: string; description?: string } | undefined;
        return `Review this task from an architecture standpoint:

Title: ${task?.title ?? "Untitled"}
Description: ${task?.description ?? "No description provided."}

Provide:
1. Architectural approach and key constraints.
2. Interfaces or contracts to define.
3. Risks and mitigation strategies.
4. Suggested sequencing for downstream implementation.`;
    }
}

export class ProfileManager {
	private profiles: Map<string, ACPProfile> = new Map();
	private profileStates: Map<string, ProfileState> = new Map();
	private taskQueues: Map<string, unknown[]> = new Map();
	private processingHistory: Map<
		string,
		Array<{ timestamp: Date; duration: number; success: boolean }>
	> = new Map();

	constructor() {
		this.registerProfile(new ProductManagerProfile());
		this.registerProfile(new ProjectManagerProfile());
		this.registerProfile(new PrincipalArchitectProfile());
		this.registerProfile(new SeniorDeveloperProfile());
		this.registerProfile(new RefinementProfile());
		this.registerProfile(new DevelopmentProfile());
		this.registerProfile(new UXSpecialistProfile());
		this.registerProfile(new QAProfile());
		this.initializeProfileStates();
	}

	protected registerProfile(profile: ACPProfile): void {
		this.profiles.set(profile.name, profile);
		this.taskQueues.set(profile.name, []);
		this.processingHistory.set(profile.name, []);
	}

	private initializeProfileStates(): void {
		for (const profile of this.profiles.values()) {
			this.profileStates.set(profile.name, {
				name: profile.name,
				isActive: true,
				currentTasks: 0,
				completedTasks: 0,
				failedTasks: 0,
				averageProcessingTime: 0,
				lastActivity: new Date(),
				queueSize: 0,
				isProcessing: false,
			});
		}
	}

	getProfile(name: string): ACPProfile | undefined {
		return this.profiles.get(name);
	}

	getAllProfiles(): ACPProfile[] {
		return Array.from(this.profiles.values());
	}

	getProfileSequence(): ACPProfile[] {
		const profiles = [
			this.getProfile("product-manager"),
			this.getProfile("project-manager"),
			this.getProfile("principal-architect"),
			this.getProfile("senior-developer"),
			this.getProfile("qa-specialist"),
		];

		// Filter out undefined profiles and assert they exist
		return profiles.filter((profile): profile is ACPProfile => profile !== undefined);
	}

	// Profile state management
	getProfileState(name: string): ProfileState | undefined {
		return this.profileStates.get(name);
	}

	getAllProfileStates(): ProfileState[] {
		return Array.from(this.profileStates.values());
	}

	updateProfileState(name: string, updates: Partial<ProfileState>): void {
		const currentState = this.profileStates.get(name);
		if (currentState) {
			const updatedState = { ...currentState, ...updates, lastActivity: new Date() };
			this.profileStates.set(name, updatedState);
		}
	}

	isProfileAvailable(name: string): boolean {
		const state = this.profileStates.get(name);
		if (!state) return true;
		return state.isActive && !state.isProcessing;
	}

	// Task queue management
	getTaskQueue(name: string): unknown[] {
		return this.taskQueues.get(name) || [];
	}

	addToTaskQueue(name: string, task: unknown): void {
		const queue = this.taskQueues.get(name) || [];
		queue.push(task);
		this.taskQueues.set(name, queue);
		this.updateProfileState(name, { queueSize: queue.length });
	}

	removeFromTaskQueue(name: string, taskIndex: number): unknown | undefined {
		const queue = this.taskQueues.get(name) || [];
		const task = queue.splice(taskIndex, 1)[0];
		if (task) {
			this.taskQueues.set(name, queue);
			this.updateProfileState(name, { queueSize: queue.length });
		}
		return task;
	}

	// Profile metrics
	getProfileMetrics(name: string): ProfileMetrics | undefined {
		const state = this.profileStates.get(name);
		const history = this.processingHistory.get(name) || [];

		if (!state) return undefined;

		const recentHistory = history.filter(
			(h) => Date.now() - h.timestamp.getTime() < 3600000, // Last hour
		);

		const successfulTasks = recentHistory.filter((h) => h.success);
		const throughput = recentHistory.length / (recentHistory.length > 0 ? 1 : 1); // tasks per hour
		const successRate =
			recentHistory.length > 0 ? (successfulTasks.length / recentHistory.length) * 100 : 100;
		const averageTaskDuration =
			recentHistory.length > 0
				? recentHistory.reduce((sum, h) => sum + h.duration, 0) / recentHistory.length
				: 0;
		const queueWaitTime = state.queueSize > 0 ? averageTaskDuration * state.queueSize : 0;
		const errorRate = 100 - successRate;

		return {
			throughput,
			successRate,
			averageTaskDuration,
			queueWaitTime,
			errorRate,
		};
	}

	getAllProfileMetrics(): Map<string, ProfileMetrics> {
		const metrics = new Map<string, ProfileMetrics>();
		for (const profileName of this.profiles.keys()) {
			const profileMetrics = this.getProfileMetrics(profileName);
			if (profileMetrics) {
				metrics.set(profileName, profileMetrics);
			}
		}
		return metrics;
	}

	// Task processing tracking
	recordTaskProcessing(name: string, duration: number, success: boolean): void {
		const history = this.processingHistory.get(name) || [];
		history.push({ timestamp: new Date(), duration, success });

		// Keep only last 100 records
		if (history.length > 100) {
			history.splice(0, history.length - 100);
		}

		this.processingHistory.set(name, history);

		// Update profile state
		const state = this.profileStates.get(name);
		if (state) {
			const completedTasks = success ? state.completedTasks + 1 : state.completedTasks;
			const failedTasks = success ? state.failedTasks : state.failedTasks + 1;
			const totalTasks = completedTasks + failedTasks;
			const averageProcessingTime =
				totalTasks > 0
					? (state.averageProcessingTime * (totalTasks - 1) + duration) / totalTasks
					: duration;

			this.updateProfileState(name, {
				completedTasks,
				failedTasks,
				averageProcessingTime,
				currentTasks: Math.max(0, state.currentTasks - 1),
			});
		}
	}

	startTaskProcessing(name: string): void {
		this.updateProfileState(name, {
			isProcessing: true,
			currentTasks: (this.profileStates.get(name)?.currentTasks || 0) + 1,
		});
	}

	endTaskProcessing(name: string): void {
		this.updateProfileState(name, { isProcessing: false });
	}

	// Profile capabilities
	getProfilesByCapability(capability: string): ACPProfile[] {
		return this.getAllProfiles().filter((profile) => profile.capabilities?.includes(capability));
	}

	// Smart task routing
	getBestProfileForTask(task: Record<string, unknown>): ACPProfile | undefined {
		void task;
		const availableProfiles = this.getAllProfiles().filter((profile) => {
			const state = this.profileStates.get(profile.name);
			return state?.isActive && state.currentTasks < (profile.maxConcurrentTasks || 1);
		});

		if (availableProfiles.length === 0) return undefined;

		// Sort by priority and current load
		availableProfiles.sort((a, b) => {
			const stateA = this.profileStates.get(a.name);
			const stateB = this.profileStates.get(b.name);

			if (!stateA || !stateB) {
				return 0;
			}

			// Primary sort by priority
			if ((a.priority || 0) !== (b.priority || 0)) {
				return (b.priority || 0) - (a.priority || 0);
			}

			// Secondary sort by current load
			return stateA.currentTasks - stateB.currentTasks;
		});

		return availableProfiles[0];
	}
}
