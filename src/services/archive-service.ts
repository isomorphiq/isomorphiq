import path from "node:path";
import type { Task, TaskStatus } from "../types.ts";

export interface RetentionPolicy {
	id: string;
	name: string;
	description: string;
	conditions: RetentionCondition[];
	action: RetentionAction;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
	createdBy: string;
}

export interface RetentionCondition {
	field: "status" | "priority" | "type" | "age" | "createdBy" | "updatedAt";
	operator: "equals" | "not_equals" | "greater_than" | "less_than" | "contains" | "in";
	value: string | string[] | number | Date;
}

export interface RetentionAction {
	type: "archive" | "delete" | "flag";
	archiveLocation?: string;
	notifyUsers?: string[];
	addTags?: string[];
}

export interface ArchivedTask {
	id: string;
	originalTask: Task;
	archivedAt: Date;
	archivedBy: string;
	reason: string;
	retentionPolicyId?: string;
	metadata: {
		originalStatus: TaskStatus;
		archivalReason: string;
		complianceTags: string[];
	};
}

export interface ArchiveStats {
	totalArchived: number;
	totalDeleted: number;
	policiesExecuted: number;
	lastExecution: Date;
	archiveSize: number;
	policyBreakdown: Record<string, {
		archived: number;
		deleted: number;
		flagged: number;
	}>;
}

export class ArchiveService {
	private archiveDb: any;
	private retentionPoliciesDb: any;
	private dbPath: string;
	private archiveDbPath: string;

	constructor() {
		this.dbPath = path.join(process.cwd(), "db");
		this.archiveDbPath = path.join(process.cwd(), "archive-db");
	}

	async initialize(): Promise<void> {
		try {
			// Initialize archive database
			const { Level } = await import("level");
			this.archiveDb = new Level(this.archiveDbPath, { valueEncoding: "json" });
			this.retentionPoliciesDb = new Level(
				path.join(this.archiveDbPath, "retention-policies"), 
				{ valueEncoding: "json" }
			);
			
			await this.archiveDb.open();
			await this.retentionPoliciesDb.open();
			
			console.log("[ARCHIVE] Archive service initialized");
		} catch (error) {
			console.error("[ARCHIVE] Failed to initialize archive service:", error);
			throw error;
		}
	}

	/**
	 * Archive a specific task
	 */
	async archiveTask(taskId: string, reason: string, archivedBy: string, options?: {
		retentionPolicyId?: string;
		tags?: string[];
	}): Promise<ArchivedTask> {
		try {
			// Get the original task from main database
			const { Level } = await import("level");
			const mainDb = new Level(this.dbPath, { valueEncoding: "json" });
			await mainDb.open();
			
	const originalTaskData = await mainDb.get(taskId) as unknown as Task;
			const archivedTask: ArchivedTask = {
				id: `archived-${taskId}-${Date.now()}`,
				originalTask: originalTaskData,
				archivedAt: new Date(),
				archivedBy,
				reason,
				retentionPolicyId: options?.retentionPolicyId,
				metadata: {
					originalStatus: originalTaskData.status,
					archivalReason: reason,
					complianceTags: options?.tags || []
				}
			};

			// Store in archive database
			await this.archiveDb.put(archivedTask.id, archivedTask);

			// Remove from main database (optional - could also mark as archived)
			const deleteDb = new Level(this.dbPath, { valueEncoding: "json" });
			await deleteDb.open();
			await deleteDb.del(taskId);
			await deleteDb.close();

			console.log(`[ARCHIVE] Task ${taskId} archived successfully`);
			return archivedTask;
		} catch (error) {
			console.error(`[ARCHIVE] Failed to archive task ${taskId}:`, error);
			throw error;
		}
	}

	/**
	 * Restore an archived task
	 */
	async restoreTask(archivedTaskId: string, restoredBy: string): Promise<Task> {
		try {
			console.log(`[ARCHIVE] Restoring task ${archivedTaskId} by ${restoredBy}`);
			// Get archived task
			const archivedTask = await this.archiveDb.get(archivedTaskId);
			
			// Restore to main database
			const { Level } = await import("level");
			const mainDb = new Level(this.dbPath, { valueEncoding: "json" });
			await mainDb.open();
			
			const restoredTask = {
				...archivedTask.originalTask,
				status: "todo" as TaskStatus,
				updatedAt: new Date().toISOString(),
			};
			
			await mainDb.put(restoredTask.id, restoredTask);
			await mainDb.close();

			// Remove from archive
			await this.archiveDb.del(archivedTaskId);

			console.log(`[ARCHIVE] Task ${archivedTask.originalTask.id} restored successfully`);
			return restoredTask;
		} catch (error) {
			console.error(`[ARCHIVE] Failed to restore task ${archivedTaskId}:`, error);
			throw error;
		}
	}

	/**
	 * Create a retention policy
	 */
	async createRetentionPolicy(policy: Omit<RetentionPolicy, "id" | "createdAt" | "updatedAt">): Promise<RetentionPolicy> {
		try {
			const newPolicy: RetentionPolicy = {
				...policy,
				id: `policy-${Date.now()}`,
				createdAt: new Date(),
				updatedAt: new Date()
			};

			await this.retentionPoliciesDb.put(newPolicy.id, newPolicy);
			console.log(`[ARCHIVE] Retention policy created: ${newPolicy.name}`);
			return newPolicy;
		} catch (error) {
			console.error("[ARCHIVE] Failed to create retention policy:", error);
			throw error;
		}
	}

	/**
	 * Get all retention policies
	 */
	async getRetentionPolicyList(): Promise<RetentionPolicy[]> {
		try {
			const policies: RetentionPolicy[] = [];
			for await (const [, value] of this.retentionPoliciesDb.iterator()) {
				policies.push(value);
			}
			return policies;
		} catch (error) {
			console.error("[ARCHIVE] Failed to get retention policies:", error);
			throw error;
		}
	}

	/**
	 * Execute retention policies against tasks
	 */
	async executeRetentionPolicy(policyId: string, executedBy: string): Promise<{
		archived: ArchivedTask[];
		deleted: string[];
		flagged: string[];
	}> {
		try {
			const policy = await this.retentionPoliciesDb.get(policyId);
			if (!policy.isActive) {
				throw new Error("Policy is not active");
			}

			const result = { archived: [] as ArchivedTask[], deleted: [] as string[], flagged: [] as string[] };

			// Get all tasks from main database
			const { Level } = await import("level");
				const mainDb = new Level(this.dbPath, { valueEncoding: "json" });
				await mainDb.open();

				const matchingTasks: Task[] = [];
				for await (const [, task] of mainDb.iterator()) {
					const taskData = task as unknown as Task;
					if (this.taskMatchesConditions(taskData, policy.conditions)) {
						matchingTasks.push(taskData);
					}
				}

			await mainDb.close();

			// Apply policy actions
			for (const task of matchingTasks) {
				switch (policy.action.type) {
					case "archive": {
						const archived = await this.archiveTask(
							task.id,
							`Automated archival: ${policy.name}`,
							executedBy,
							{ retentionPolicyId: policyId }
						);
						result.archived.push(archived);
						break;
					}

					case "delete": {
						const deleteDb = new Level(this.dbPath, { valueEncoding: "json" });
						await deleteDb.open();
						await deleteDb.del(task.id);
						await deleteDb.close();
						result.deleted.push(task.id);
						break;
					}

					case "flag":
						result.flagged.push(task.id);
						// Could add tags or notifications here
						break;
				}
			}

			// Update policy execution timestamp
			policy.updatedAt = new Date();
			await this.retentionPoliciesDb.put(policyId, policy);

			console.log(`[ARCHIVE] Policy ${policy.name} executed: ${result.archived.length} archived, ${result.deleted.length} deleted`);
			return result;
		} catch (error) {
			console.error(`[ARCHIVE] Failed to execute retention policy ${policyId}:`, error);
			throw error;
		}
	}

	/**
	 * Search archived tasks
	 */
	async searchArchivedTasks(query: {
		text?: string;
		archivedBy?: string;
		dateFrom?: Date;
		dateTo?: Date;
		retentionPolicyId?: string;
		originalStatus?: TaskStatus;
	}): Promise<ArchivedTask[]> {
		try {
			const results: ArchivedTask[] = [];
			
			for await (const [, archivedTask] of this.archiveDb.iterator()) {
				let matches = true;

				// Text search in title and description
				if (query.text) {
					const searchText = query.text.toLowerCase();
					const title = archivedTask.originalTask.title.toLowerCase();
					const description = archivedTask.originalTask.description.toLowerCase();
					if (!title.includes(searchText) && !description.includes(searchText)) {
						matches = false;
					}
				}

				// Archived by filter
				if (query.archivedBy && archivedTask.archivedBy !== query.archivedBy) {
					matches = false;
				}

				// Date range filter
				if (query.dateFrom && new Date(archivedTask.archivedAt) < query.dateFrom) {
					matches = false;
				}
				if (query.dateTo && new Date(archivedTask.archivedAt) > query.dateTo) {
					matches = false;
				}

				// Policy filter
				if (query.retentionPolicyId && archivedTask.retentionPolicyId !== query.retentionPolicyId) {
					matches = false;
				}

				// Original status filter
				if (query.originalStatus && archivedTask.metadata.originalStatus !== query.originalStatus) {
					matches = false;
				}

				if (matches) {
					results.push(archivedTask);
				}
			}

			return results.sort((a, b) => 
				new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime()
			);
		} catch (error) {
			console.error("[ARCHIVE] Failed to search archived tasks:", error);
			throw error;
		}
	}

	/**
	 * Get archive statistics
	 */
	async getArchiveStats(): Promise<ArchiveStats> {
		try {
			const stats: ArchiveStats = {
				totalArchived: 0,
				totalDeleted: 0,
				policiesExecuted: 0,
				lastExecution: new Date(),
				archiveSize: 0,
				policyBreakdown: {}
			};

			// Count archived tasks
			for await (const [, archivedTask] of this.archiveDb.iterator()) {
				stats.totalArchived++;
				
				// Track policy breakdown
				if (archivedTask.retentionPolicyId) {
					const policyId = archivedTask.retentionPolicyId;
					if (!stats.policyBreakdown[policyId]) {
						stats.policyBreakdown[policyId] = { archived: 0, deleted: 0, flagged: 0 };
					}
					stats.policyBreakdown[policyId].archived++;
				}
			}

			return stats;
		} catch (error) {
			console.error("[ARCHIVE] Failed to get archive stats:", error);
			throw error;
		}
	}

	/**
	 * Check if a task matches retention conditions
	 */
	private taskMatchesConditions(task: Task, conditions: RetentionCondition[]): boolean {
		return conditions.every(condition => {
			const taskValue = this.getTaskFieldValue(task, condition.field);
			return this.evaluateCondition(taskValue, condition.operator, condition.value);
		});
	}

	/**
	 * Get field value from task
	 */
	private getTaskFieldValue(task: Task, field: string): any {
		switch (field) {
			case "status": return task.status;
			case "priority": return task.priority;
			case "type": return task.type;
			case "createdBy": return task.createdBy;
			case "updatedAt": return new Date(task.updatedAt);
			case "age": {
				const created = new Date(task.createdAt);
				const now = new Date();
				return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)); // days
			}
			default: return null;
		}
	}

	/**
	 * Evaluate condition
	 */
	private evaluateCondition(taskValue: any, operator: string, conditionValue: any): boolean {
		switch (operator) {
			case "equals": return taskValue === conditionValue;
			case "not_equals": return taskValue !== conditionValue;
			case "greater_than": return taskValue > conditionValue;
			case "less_than": return taskValue < conditionValue;
			case "contains": 
				return typeof taskValue === "string" && 
					   taskValue.toLowerCase().includes(String(conditionValue).toLowerCase());
			case "in": return Array.isArray(conditionValue) && conditionValue.includes(taskValue);
			default: return false;
		}
	}

	/**
	 * Cleanup old archived tasks (permanent deletion)
	 */
	async cleanupOldArchivedTasks(olderThanDays: number): Promise<string[]> {
		try {
			const cutoffDate = new Date();
			cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
			
			const deletedIds: string[] = [];
			
			for await (const [id, archivedTask] of this.archiveDb.iterator()) {
				if (new Date(archivedTask.archivedAt) < cutoffDate) {
					await this.archiveDb.del(id);
					deletedIds.push(id);
				}
			}

			console.log(`[ARCHIVE] Cleaned up ${deletedIds.length} old archived tasks`);
			return deletedIds;
		} catch (error) {
			console.error("[ARCHIVE] Failed to cleanup old archived tasks:", error);
			throw error;
		}
	}

	/**
	 * Export archived tasks for compliance
	 */
	async exportArchivedTasks(format: "json" | "csv" = "json"): Promise<string | Buffer> {
		try {
			const archivedTasks = [];
			for await (const [, archivedTask] of this.archiveDb.iterator()) {
				archivedTasks.push(archivedTask);
			}

			if (format === "json") {
				return JSON.stringify(archivedTasks, null, 2);
			} else if (format === "csv") {
				// Simple CSV export
				const headers = [
					"ID", "Title", "Description", "Original Status", "Archived At", 
					"Archived By", "Reason", "Policy ID"
				];
				
				const rows = archivedTasks.map(task => [
					task.originalTask.id,
					task.originalTask.title,
					task.originalTask.description,
					task.metadata.originalStatus,
					task.archivedAt.toISOString(),
					task.archivedBy,
					task.reason,
					task.retentionPolicyId || ""
				]);

				return [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
			}

			throw new Error(`Unsupported export format: ${format}`);
		} catch (error) {
			console.error("[ARCHIVE] Failed to export archived tasks:", error);
			throw error;
		}
	}
}
