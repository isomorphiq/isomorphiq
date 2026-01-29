import path from "node:path";
import type { KeyValueStore, KeyValueStoreFactory } from "./persistence/key-value-store.ts";
import { createLevelStore } from "./persistence/key-value-store.ts";
import type {
    AutomationRule,
    CreateTaskFromTemplateInput,
    SubtaskTemplate,
    Task,
    TaskTemplate,
    TemplateCategory,
    TemplateVariable,
} from "./types.ts";

// Template Manager class to handle template operations
export type TemplateManagerOptions = {
    storeFactory?: KeyValueStoreFactory;
};

export class TemplateManager {
	private templateDb!: KeyValueStore<string, TaskTemplate>;
	private ruleDb!: KeyValueStore<string, AutomationRule>;
	private dbReady = false;
	private dbPath: string;
	private initializing = false;
    private storeFactory: KeyValueStoreFactory;

	constructor(dbPath?: string, options: TemplateManagerOptions = {}) {
		this.dbPath = dbPath || path.join(process.cwd(), "db");
        this.storeFactory = options.storeFactory ?? createLevelStore;
	}

	// Ensure databases are open
	private async ensureDatabases(): Promise<void> {
		if (this.dbReady) return;
		if (this.initializing) {
			// Wait for initialization to complete
			while (this.initializing) {
				await new Promise(resolve => setTimeout(resolve, 10));
			}
			return;
		}

		this.initializing = true;
		try {
			this.templateDb = this.storeFactory<string, TaskTemplate>(path.join(this.dbPath, "templates"));
			this.ruleDb = this.storeFactory<string, AutomationRule>(path.join(this.dbPath, "automation-rules"));

            await this.templateDb.open();
			await this.ruleDb.open();
			this.dbReady = true;
			console.log("[TEMPLATE] Template databases opened successfully");
		} catch (error) {
			this.initializing = false;
			throw error;
		}
		this.initializing = false;
	}

	// Create a new template
	async createTemplate(
		name: string,
		description: string,
		category: TemplateCategory,
		titleTemplate: string,
		descriptionTemplate: string,
		priority: "low" | "medium" | "high" = "medium",
		variables: TemplateVariable[] = [],
		subtasks: SubtaskTemplate[] = [],
	): Promise<TaskTemplate> {
		await this.ensureDatabases();

		const id = `template-${Date.now()}`;
		const template: TaskTemplate = {
			id,
			name,
			description,
			category,
			titleTemplate,
			descriptionTemplate,
			priority,
			variables,
			subtasks,
			automationRules: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		try {
			await this.templateDb.put(id, template);
			console.log(`[TEMPLATE] Created template: ${id}`);
			return template;
		} catch (error) {
			console.error("[TEMPLATE] Failed to create template:", error);
			throw error;
		}
	}

	// Get all templates
	async getAllTemplates(): Promise<TaskTemplate[]> {
		await this.ensureDatabases();

		const templates: TaskTemplate[] = [];
		const iterator = this.templateDb.iterator();
		try {
			for await (const [, value] of iterator) {
				templates.push(value);
			}
		} catch (error) {
			console.error("[TEMPLATE] Error reading templates:", error);
			return [];
		} finally {
			try {
				await iterator.close();
			} catch (closeError) {
				console.error("[TEMPLATE] Error closing iterator:", closeError);
			}
		}
		return templates;
	}

	// Get template by ID
	async getTemplate(id: string): Promise<TaskTemplate | null> {
		await this.ensureDatabases();

		try {
			const template = await this.templateDb.get(id);
			return template;
		} catch (_error) {
			console.log(`[TEMPLATE] Template ${id} not found`);
			return null;
		}
	}

	// Update template
	async updateTemplate(id: string, updates: Partial<TaskTemplate>): Promise<TaskTemplate> {
		await this.ensureDatabases();

		const template = await this.templateDb.get(id);
		const updatedTemplate = {
			...template,
			...updates,
			id, // Ensure ID doesn't change
			updatedAt: new Date(),
		};

		await this.templateDb.put(id, updatedTemplate);
		console.log(`[TEMPLATE] Updated template: ${id}`);
		return updatedTemplate;
	}

	// Delete template
	async deleteTemplate(id: string): Promise<void> {
		await this.ensureDatabases();
		await this.templateDb.del(id);
		console.log(`[TEMPLATE] Deleted template: ${id}`);
	}

	// Substitute variables in template strings
	substituteVariables(template: string, variables: Record<string, unknown>): string {
		return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
			if (Object.hasOwn(variables, varName)) {
				const value = variables[varName];
				if (value === null || value === undefined) {
					return "";
				}
				return String(value);
			}
			console.warn(`[TEMPLATE] Variable ${varName} not found in substitution`);
			return match;
		});
	}

	// Create task from template
	async createTaskFromTemplate(
		input: CreateTaskFromTemplateInput,
		createTaskFn: (
			title: string,
			description: string,
			priority: "low" | "medium" | "high",
			dependencies?: string[],
		) => Promise<Task>,
	): Promise<{ mainTask: Task; subtasks: Task[] }> {
		const template = await this.getTemplate(input.templateId);
		if (!template) {
			throw new Error(`Template ${input.templateId} not found`);
		}

		// Validate required variables
		const missingVars = template.variables
			.filter((v) => v.required && !Object.hasOwn(input.variables, v.name))
			.map((v) => v.name);

		if (missingVars.length > 0) {
			throw new Error(`Missing required variables: ${missingVars.join(", ")}`);
		}

		// Substitute variables in main task
		const title = this.substituteVariables(template.titleTemplate, input.variables);
		const description = this.substituteVariables(template.descriptionTemplate, input.variables);

		const mainTask = await createTaskFn(title, description, template.priority);

		// Create subtasks if requested
		const subtasks: Task[] = [];
		if (input.subtasks && template.subtasks) {
			for (const subtaskTemplate of template.subtasks) {
				const subtaskTitle = this.substituteVariables(
					subtaskTemplate.titleTemplate,
					input.variables,
				);
				const subtaskDescription = this.substituteVariables(
					subtaskTemplate.descriptionTemplate,
					input.variables,
				);
				const subtaskPriority = subtaskTemplate.priority || template.priority;

				const subtask = await createTaskFn(subtaskTitle, subtaskDescription, subtaskPriority, [
					mainTask.id,
				]);
				subtasks.push(subtask);
			}
		}

		console.log(`[TEMPLATE] Created task from template ${input.templateId}: ${mainTask.id}`);
		return { mainTask, subtasks };
	}

	// Create predefined templates
	async createPredefinedTemplates(): Promise<void> {
		console.log("[TEMPLATE] Creating predefined templates...");

		// Bug Fix Template
		await this.createTemplate(
			"Bug Fix",
			"Template for fixing bugs and issues",
			"bug-fix",
			"Fix: {{bugTitle}}",
			"Fix the following issue: {{bugDescription}}\n\nSteps to reproduce:\n{{reproductionSteps}}\n\nExpected behavior:\n{{expectedBehavior}}\n\nActual behavior:\n{{actualBehavior}}",
			"high",
			[
				{
					name: "bugTitle",
					type: "text",
					description: "Title of the bug",
					required: true,
				},
				{
					name: "bugDescription",
					type: "text",
					description: "Description of the bug",
					required: true,
				},
				{
					name: "reproductionSteps",
					type: "text",
					description: "Steps to reproduce the bug",
					required: true,
				},
				{
					name: "expectedBehavior",
					type: "text",
					description: "Expected behavior",
					required: true,
				},
				{
					name: "actualBehavior",
					type: "text",
					description: "Actual behavior",
					required: true,
				},
			],
			[
				{
					titleTemplate: "Investigate: {{bugTitle}}",
					descriptionTemplate: "Investigate the root cause of: {{bugDescription}}",
					priority: "high",
				},
				{
					titleTemplate: "Test fix for: {{bugTitle}}",
					descriptionTemplate:
						"Test the fix for: {{bugDescription}}\n\nVerify:\n- {{expectedBehavior}}",
					priority: "medium",
				},
			],
		);

		// Feature Development Template
		await this.createTemplate(
			"Feature Development",
			"Template for implementing new features",
			"feature",
			"Feature: {{featureName}}",
			"Implement the following feature: {{featureDescription}}\n\nRequirements:\n{{requirements}}\n\nAcceptance criteria:\n{{acceptanceCriteria}}",
			"medium",
			[
				{
					name: "featureName",
					type: "text",
					description: "Name of the feature",
					required: true,
				},
				{
					name: "featureDescription",
					type: "text",
					description: "Description of the feature",
					required: true,
				},
				{
					name: "requirements",
					type: "text",
					description: "Technical requirements",
					required: true,
				},
				{
					name: "acceptanceCriteria",
					type: "text",
					description: "Acceptance criteria",
					required: true,
				},
			],
			[
				{
					titleTemplate: "Design: {{featureName}}",
					descriptionTemplate:
						"Design the architecture and implementation plan for: {{featureDescription}}",
					priority: "medium",
				},
				{
					titleTemplate: "Implement: {{featureName}}",
					descriptionTemplate: "Implement the core functionality for: {{featureDescription}}",
					priority: "high",
				},
				{
					titleTemplate: "Test: {{featureName}}",
					descriptionTemplate:
						"Write tests for: {{featureDescription}}\n\nTest cases:\n- {{acceptanceCriteria}}",
					priority: "medium",
				},
			],
		);

		// Code Review Template
		await this.createTemplate(
			"Code Review",
			"Template for conducting code reviews",
			"development",
			"Review: {{componentName}}",
			"Review the code changes in: {{componentName}}\n\nChanges description:\n{{changesDescription}}\n\nReview focus areas:\n{{reviewAreas}}",
			"medium",
			[
				{
					name: "componentName",
					type: "text",
					description: "Name of component being reviewed",
					required: true,
				},
				{
					name: "changesDescription",
					type: "text",
					description: "Description of changes",
					required: true,
				},
				{
					name: "reviewAreas",
					type: "text",
					description: "Areas to focus on during review",
					required: true,
				},
			],
		);

		// Documentation Update Template
		await this.createTemplate(
			"Documentation Update",
			"Template for updating documentation",
			"documentation",
			"Docs: {{docTitle}}",
			"Update documentation for: {{docTitle}}\n\nDocumentation type:\n{{docType}}\n\nContent to update:\n{{contentUpdate}}",
			"low",
			[
				{
					name: "docTitle",
					type: "text",
					description: "Title of documentation",
					required: true,
				},
				{
					name: "docType",
					type: "select",
					description: "Type of documentation",
					required: true,
					options: ["API", "User Guide", "README", "Code Comments", "Architecture"],
				},
				{
					name: "contentUpdate",
					type: "text",
					description: "Content to update or add",
					required: true,
				},
			],
		);

		// Testing Template
		await this.createTemplate(
			"Testing",
			"Template for creating comprehensive tests",
			"testing",
			"Tests: {{testTarget}}",
			"Create comprehensive tests for: {{testTarget}}\n\nTest requirements:\n{{testRequirements}}\n\nTest types needed:\n{{testTypes}}",
			"medium",
			[
				{
					name: "testTarget",
					type: "text",
					description: "Component or feature to test",
					required: true,
				},
				{
					name: "testRequirements",
					type: "text",
					description: "Testing requirements",
					required: true,
				},
				{
					name: "testTypes",
					type: "select",
					description: "Types of tests needed",
					required: true,
					options: ["Unit Tests", "Integration Tests", "E2E Tests", "Performance Tests"],
				},
			],
			[
				{
					titleTemplate: "Unit tests for: {{testTarget}}",
					descriptionTemplate:
						"Write unit tests for: {{testTarget}}\n\nRequirements: {{testRequirements}}",
					priority: "high",
				},
				{
					titleTemplate: "Integration tests for: {{testTarget}}",
					descriptionTemplate: "Write integration tests for: {{testTarget}}",
					priority: "medium",
				},
			],
		);

		console.log("[TEMPLATE] Predefined templates created successfully");

		// Create predefined automation rules
		await this.createPredefinedAutomationRules();
	}

	// Create predefined automation rules
	async createPredefinedAutomationRules(): Promise<void> {
		console.log("[TEMPLATE] Creating predefined automation rules...");

		// Rule: Auto-assign high priority bugs to senior developer
		await this.createAutomationRule({
			name: "Auto-assign High Priority Bugs",
			trigger: {
				eventType: "task_created",
				type: "task_created",
				parameters: {},
			},
			conditions: [
				{
					field: "task.title",
					operator: "contains",
					value: "Fix:",
				},
				{
					field: "task.priority",
					operator: "equals",
					value: "high",
				},
			],
			actions: [
				{
					type: "assign_user",
					parameters: {
						assignedTo: "senior-developer",
					},
				},
				{
					type: "send_notification",
					parameters: {
						message: "High priority bug \"{{taskTitle}}\" has been auto-assigned to senior-developer",
						recipient: "team-lead",
					},
				},
			],
			enabled: true,
		});

		// Rule: Create follow-up task when task is completed
		await this.createAutomationRule({
			name: "Create Testing Task on Development Complete",
			trigger: {
				eventType: "task_status_changed",
				type: "task_status_changed",
				parameters: {},
			},
			conditions: [
				{
					field: "newStatus",
					operator: "equals",
					value: "done",
				},
				{
					field: "task.title",
					operator: "contains",
					value: "Task:",
				},
			],
			actions: [
				{
					type: "create_task",
					parameters: {
						title: "Test: {{taskTitle}}",
						description:
							"Test the completed task: {{taskTitle}}\n\nOriginal task description: {{taskDescription}}",
						priority: "medium",
					},
				},
			],
			enabled: true,
		});

		// Rule: Escalate overdue tasks
		await this.createAutomationRule({
			name: "Escalate Long-running Tasks",
			trigger: {
				eventType: "scheduled",
				type: "scheduled",
				parameters: { schedule: "daily" },
			},
			conditions: [
				{
					field: "task.status",
					operator: "equals",
					value: "in-progress",
				},
			],
			actions: [
				{
					type: "send_notification",
					parameters: {
						message:
							"Task \"{{taskTitle}}\" has been in progress for more than 3 days and may need attention",
						recipient: "project-manager",
					},
				},
			],
			enabled: false, // Disabled by default
		});

		// Rule: Auto-set priority for feature tasks
		await this.createAutomationRule({
			name: "Set Priority for Feature Tasks",
			trigger: {
				eventType: "task_created",
				type: "task_created",
				parameters: {},
			},
			conditions: [
				{
					field: "task.title",
					operator: "contains",
					value: "Feature:",
				},
			],
			actions: [
				{
					type: "set_priority",
					parameters: {
						priority: "medium",
					},
				},
			],
			enabled: true,
		});

		console.log("[TEMPLATE] Predefined automation rules created successfully");
	}

	// Automation Rules Management
	async createAutomationRule(
		rule: Omit<AutomationRule, "id" | "createdAt">,
	): Promise<AutomationRule> {
		await this.ensureDatabases();

		const id = `rule-${Date.now()}`;
		const newRule: AutomationRule = {
			...rule,
			id,
			createdAt: new Date(),
		};

		await this.ruleDb.put(id, newRule);
		console.log(`[TEMPLATE] Created automation rule: ${id}`);
		return newRule;
	}

	async getAllAutomationRules(): Promise<AutomationRule[]> {
		await this.ensureDatabases();

		const rules: AutomationRule[] = [];
		const iterator = this.ruleDb.iterator();
		try {
			for await (const [, value] of iterator) {
				rules.push(value);
			}
		} catch (error) {
			console.error("[TEMPLATE] Error reading automation rules:", error);
			return [];
		} finally {
			try {
				await iterator.close();
			} catch (closeError) {
				console.error("[TEMPLATE] Error closing iterator:", closeError);
			}
		}
		return rules;
	}

	async updateAutomationRule(
		id: string,
		updates: Partial<AutomationRule>,
	): Promise<AutomationRule> {
		await this.ensureDatabases();

		const rule = await this.ruleDb.get(id);
		const updatedRule = { ...rule, ...updates, id };

		await this.ruleDb.put(id, updatedRule);
		console.log(`[TEMPLATE] Updated automation rule: ${id}`);
		return updatedRule;
	}

	async deleteAutomationRule(id: string): Promise<void> {
		await this.ensureDatabases();
		await this.ruleDb.del(id);
		console.log(`[TEMPLATE] Deleted automation rule: ${id}`);
	}
}
