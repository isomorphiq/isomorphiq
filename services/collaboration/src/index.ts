import { NotFoundError, UnauthorizedError, type Result } from "@isomorphiq/core";
import type { User } from "@isomorphiq/auth";

// Operational Transformation interfaces
export interface TextOperation {
	type: "retain" | "insert" | "delete";
	position: number;
	text?: string;
	length?: number;
}

export interface TaskEditOperation {
	id: string;
	taskId: string;
	userId: string;
	field: "title" | "description";
	operation: TextOperation;
	timestamp: Date;
	revision: number;
}

export interface TaskEditSession {
	id: string;
	taskId: string;
	activeUsers: Map<string, UserPresence>;
	operations: TaskEditOperation[];
	currentRevision: number;
	createdAt: Date;
	lastActivity: Date;
}

export interface UserPresence {
	userId: string;
	username: string;
	cursor: {
		field: "title" | "description";
		position: number;
		selection?: { start: number; end: number };
	};
	color: string;
	isTyping: boolean;
	lastSeen: Date;
}

export interface ConflictResolution {
	operation: TaskEditOperation;
	resolvedOperation: TaskEditOperation;
	conflictType: "concurrent_edit" | "delete_conflict" | "field_conflict";
	resolution: "accept" | "merge" | "reject";
}

// Collaboration service interface
/* eslint-disable no-unused-vars */
export interface ICollaborationService {
	// Session management
	joinTaskSession(taskId: string, userId: string, user: User): Promise<Result<TaskEditSession>>;
	leaveTaskSession(taskId: string, userId: string): Promise<Result<void>>;
	getActiveSession(taskId: string): Promise<Result<TaskEditSession | null>>;
	getUserSessions(userId: string): Promise<Result<TaskEditSession[]>>;

	// Operational transformation
	applyOperation(operation: TaskEditOperation): Promise<Result<TaskEditOperation>>;
	transformOperation(
		operation: TaskEditOperation,
		baseRevision: number,
	): Promise<Result<TaskEditOperation[]>>;
	getOperationsSince(taskId: string, revision: number): Promise<Result<TaskEditOperation[]>>;

	// Presence management
	updateUserPresence(
		taskId: string,
		userId: string,
		presence: Partial<UserPresence>,
	): Promise<Result<void>>;
	getActiveUsers(taskId: string): Promise<Result<UserPresence[]>>;

	// Conflict resolution
	resolveConflicts(operations: TaskEditOperation[]): Promise<Result<ConflictResolution[]>>;

	// Cleanup
	cleanupInactiveSessions(): Promise<Result<void>>;
}
/* eslint-enable no-unused-vars */

// --- Operational Transformation helpers (functional, no classes) ---

const transformOperations = (
	op1: TextOperation,
	op2: TextOperation,
): [TextOperation, TextOperation] => {
	if (op1.type === "insert" && op2.type === "insert") {
		if ((op1.position || 0) <= (op2.position || 0)) {
			return [op1, { ...op2, position: (op2.position || 0) + (op1.text?.length || 0) }];
		}
		return [{ ...op1, position: (op1.position || 0) + (op2.text?.length || 0) }, op2];
	}

	if (op1.type === "insert" && op2.type === "delete") {
		if ((op1.position || 0) <= (op2.position || 0)) {
			return [op1, { ...op2, position: (op2.position || 0) + (op1.text?.length || 0) }];
		}
		return [{ ...op1, position: (op1.position || 0) - (op2.length || 0) }, op2];
	}

	if (op1.type === "delete" && op2.type === "insert") {
		const [second, first] = transformOperations(op2, op1);
		return [first, second];
	}

	if (op1.type === "delete" && op2.type === "delete") {
		if ((op1.position || 0) + (op1.length || 0) <= (op2.position || 0)) {
			return [op1, { ...op2, position: (op2.position || 0) - (op1.length || 0) }];
		}
		if ((op2.position || 0) + (op2.length || 0) <= (op1.position || 0)) {
			return [{ ...op1, position: (op1.position || 0) - (op2.length || 0) }, op2];
		}
		throw new Error("Overlapping delete operations detected");
	}

	return [op1, op2];
};

// User color assignment helpers
const userColors = [
	"#3b82f6",
	"#ef4444",
	"#10b981",
	"#f59e0b",
	"#8b5cf6",
	"#ec4899",
	"#14b8a6",
	"#f97316",
];

const userColorMap = new Map<string, string>();

const getUserColor = (userId: string): string => {
	if (!userColorMap.has(userId)) {
		const colorIndex = userColorMap.size % userColors.length;
		userColorMap.set(userId, userColors[colorIndex]);
	}
	return userColorMap.get(userId) || userColors[0];
};

const releaseUserColor = (userId: string): void => {
	userColorMap.delete(userId);
};

// Collaboration service implementation
export class CollaborationService implements ICollaborationService {
	private sessions = new Map<string, TaskEditSession>();
	private userSessions = new Map<string, Set<string>>();
	private taskOperations = new Map<string, TaskEditOperation[]>();

	// Session management
	async joinTaskSession(
		taskId: string,
		userId: string,
		user: User,
	): Promise<Result<TaskEditSession>> {
		let session = this.sessions.get(taskId);

		if (!session) {
			session = {
				id: `session-${taskId}-${Date.now()}`,
				taskId,
				activeUsers: new Map(),
				operations: [],
				currentRevision: 0,
				createdAt: new Date(),
				lastActivity: new Date(),
			};
			this.sessions.set(taskId, session);
		}

		const presence: UserPresence = {
			userId,
			username: user.username,
			cursor: { field: "title", position: 0 },
			color: getUserColor(userId),
			isTyping: false,
			lastSeen: new Date(),
		};

		session.activeUsers.set(userId, presence);
		session.lastActivity = new Date();

		if (!this.userSessions.has(userId)) {
			this.userSessions.set(userId, new Set());
		}
		this.userSessions.get(userId)?.add(taskId);

		return { success: true, data: session };
	}

	async leaveTaskSession(taskId: string, userId: string): Promise<Result<void>> {
		const session = this.sessions.get(taskId);
		if (!session) {
			return { success: true, data: undefined };
		}

		session.activeUsers.delete(userId);
		session.lastActivity = new Date();

		const userSessionIds = this.userSessions.get(userId);
		userSessionIds?.delete(taskId);
		if (userSessionIds && userSessionIds.size === 0) {
			this.userSessions.delete(userId);
		}

		releaseUserColor(userId);

		if (session.activeUsers.size === 0) {
			this.sessions.delete(taskId);
			this.taskOperations.delete(taskId);
		}

		return { success: true, data: undefined };
	}

	async getActiveSession(taskId: string): Promise<Result<TaskEditSession | null>> {
		const session = this.sessions.get(taskId) || null;
		return { success: true, data: session };
	}

	async getUserSessions(userId: string): Promise<Result<TaskEditSession[]>> {
		const sessionIds = this.userSessions.get(userId) || new Set();
		const sessions: TaskEditSession[] = [];

		for (const sessionId of sessionIds) {
			const session = this.sessions.get(sessionId);
			if (session) {
				sessions.push(session);
			}
		}

		return { success: true, data: sessions };
	}

	// Operational transformation
	async applyOperation(operation: TaskEditOperation): Promise<Result<TaskEditOperation>> {
		const session = this.sessions.get(operation.taskId);
		if (!session) {
			return { success: false, error: new NotFoundError("Task session", operation.taskId) };
		}

		if (!session.activeUsers.has(operation.userId)) {
			return { success: false, error: new UnauthorizedError("edit", "task") };
		}

		const transformedOpsResult = await this.transformOperation(operation, operation.revision);
		if (!transformedOpsResult.success || !transformedOpsResult.data) {
			return { success: false, error: transformedOpsResult.error };
		}
		const finalOperation = transformedOpsResult.data[transformedOpsResult.data.length - 1];

		session.operations.push(finalOperation);
		session.currentRevision += 1;
		session.lastActivity = new Date();

		const ops = this.taskOperations.get(operation.taskId) || [];
		ops.push(finalOperation);
		this.taskOperations.set(operation.taskId, ops);

		return { success: true, data: finalOperation };
	}

	async transformOperation(
		operation: TaskEditOperation,
		baseRevision: number,
	): Promise<Result<TaskEditOperation[]>> {
		const session = this.sessions.get(operation.taskId);
		if (!session) {
			return { success: false, error: new NotFoundError("Task session", operation.taskId) };
		}

		const operations = session.operations.slice(baseRevision);
		let transformedOp = operation.operation;

		try {
			for (const concurrentOp of operations) {
				if (concurrentOp.field === operation.field && concurrentOp.userId !== operation.userId) {
					const [transformed] = transformOperations(transformedOp, concurrentOp.operation);
					transformedOp = transformed;
				}
			}

			const updatedOperation: TaskEditOperation = { ...operation, operation: transformedOp };
			return { success: true, data: [updatedOperation] };
		} catch (error) {
			return { success: false, error: error as Error };
		}
	}

	async getOperationsSince(taskId: string, revision: number): Promise<Result<TaskEditOperation[]>> {
		const session = this.sessions.get(taskId);
		if (!session) {
			return { success: true, data: [] };
		}
		return { success: true, data: session.operations.slice(revision) };
	}

	// Presence management
	async updateUserPresence(
		taskId: string,
		userId: string,
		presenceUpdate: Partial<UserPresence>,
	): Promise<Result<void>> {
		const session = this.sessions.get(taskId);
		if (!session) {
			return { success: false, error: new NotFoundError("Task session", taskId) };
		}

		const currentPresence = session.activeUsers.get(userId);
		if (!currentPresence) {
			return { success: false, error: new NotFoundError("User presence", userId) };
		}

		const updatedPresence: UserPresence = {
			...currentPresence,
			...presenceUpdate,
			lastSeen: new Date(),
		};

		session.activeUsers.set(userId, updatedPresence);
		session.lastActivity = new Date();

		return { success: true, data: undefined };
	}

	async getActiveUsers(taskId: string): Promise<Result<UserPresence[]>> {
		const session = this.sessions.get(taskId);
		if (!session) {
			return { success: true, data: [] };
		}

		return { success: true, data: Array.from(session.activeUsers.values()) };
	}

	// Conflict resolution
	async resolveConflicts(operations: TaskEditOperation[]): Promise<Result<ConflictResolution[]>> {
		const resolutions: ConflictResolution[] = [];
		const operationGroups = new Map<string, TaskEditOperation[]>();

		for (const op of operations) {
			const key = `${op.taskId}-${op.field}-${op.timestamp.getTime()}`;
			const list = operationGroups.get(key) || [];
			list.push(op);
			operationGroups.set(key, list);
		}

		for (const [, group] of operationGroups) {
			if (group.length > 1) {
				const resolution = await this.resolveConflictGroup(group);
				resolutions.push(resolution);
			}
		}

		return { success: true, data: resolutions };
	}

	private async resolveConflictGroup(operations: TaskEditOperation[]): Promise<ConflictResolution> {
		const sortedOps = [...operations].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
		const lastOp = sortedOps[sortedOps.length - 1];

		return {
			operation: lastOp,
			resolvedOperation: lastOp,
			conflictType: "concurrent_edit",
			resolution: "accept",
		};
	}

	// Cleanup
	async cleanupInactiveSessions(): Promise<Result<void>> {
		const now = new Date();
		const inactiveThreshold = 30 * 60 * 1000; // 30 minutes

		for (const [taskId, session] of this.sessions) {
			const timeSinceActivity = now.getTime() - session.lastActivity.getTime();
			if (timeSinceActivity > inactiveThreshold) {
				for (const [userId, presence] of session.activeUsers) {
					const timeSinceSeen = now.getTime() - presence.lastSeen.getTime();
					if (timeSinceSeen > inactiveThreshold) {
						releaseUserColor(userId);
						session.activeUsers.delete(userId);
					}
				}

				if (session.activeUsers.size === 0) {
					this.sessions.delete(taskId);
					this.taskOperations.delete(taskId);
				}
			}
		}

		return { success: true, data: undefined };
	}
}

// Singleton instance
let collaborationService: CollaborationService | null = null;

export function getCollaborationService(): CollaborationService {
	if (!collaborationService) {
		collaborationService = new CollaborationService();
	}
	return collaborationService;
}
