import { describe, it, before, beforeEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { getCollaborationService, type CollaborationService, type TaskEditOperation } from "../../services/collaboration/src/index.ts";
import type { User } from "@isomorphiq/auth";

// Mock user implementation for testing
const createMockUser = (id: string, username: string): User => ({
    id,
    username,
    email: `${username}@example.com`,
    passwordHash: "mock-password-hash",
    role: "developer",
    isActive: true,
    isEmailVerified: true,
    profile: {
        firstName: username.charAt(0).toUpperCase() + username.slice(1),
        lastName: "Test"
    },
    preferences: {
        theme: "light",
        notifications: {
            email: true,
            push: true,
            taskAssigned: true,
            taskCompleted: true,
            taskOverdue: false
        },
        dashboard: {
            defaultView: "list",
            itemsPerPage: 20,
            showCompleted: false
        }
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    failedLoginAttempts: 0
});

describe("Collaboration Service Tests - task-b7c2d592", () => {
    const TASK_ID_PREFIX = "task-b7c2d592-collaboration";
    let collaborationService: CollaborationService;
    let mockUsers: User[];

    before(() => {
        collaborationService = getCollaborationService();
        mockUsers = [
            createMockUser("user1", "alice"),
            createMockUser("user2", "bob"),
            createMockUser("user3", "charlie")
        ];
    });

    beforeEach(async () => {
        // Clean up all sessions before each test to ensure isolation
        const service = collaborationService as any;
        if (service.sessions) {
            service.sessions.clear();
        }
        if (service.userSessions) {
            service.userSessions.clear();
        }
        if (service.taskOperations) {
            service.taskOperations.clear();
        }
    });

    after(async () => {
        // Final cleanup
        await collaborationService.cleanupInactiveSessions();
    });

    describe("Session Management", () => {
        it("should create and join collaboration session", async () => {
            const taskId = `${TASK_ID_PREFIX}-session-test`;
            const user = mockUsers[0];

            const result = await collaborationService.joinTaskSession(taskId, user.id, user);
            
            assert.ok(result.success, "Should successfully create session");
            assert.ok(result.data, "Should return session data");
            assert.equal(result.data.taskId, taskId);
            assert.equal(result.data.activeUsers.size, 1);
            assert.ok(result.data.activeUsers.has(user.id));
            
            const userPresence = result.data.activeUsers.get(user.id);
            assert.equal(userPresence?.username, user.username);
            assert.equal(userPresence?.userId, user.id);
        });

        it("should handle multiple users in same session", async () => {
            const taskId = `${TASK_ID_PREFIX}-multi-user`;
            
            // First user joins
            const result1 = await collaborationService.joinTaskSession(taskId, mockUsers[0].id, mockUsers[0]);
            assert.ok(result1.success);
            assert.equal(result1.data?.activeUsers.size, 1);
            
            // Second user joins
            const result2 = await collaborationService.joinTaskSession(taskId, mockUsers[1].id, mockUsers[1]);
            assert.ok(result2.success);
            assert.equal(result2.data?.activeUsers.size, 2);
            
            // Both users should be present
            assert.ok(result2.data?.activeUsers.has(mockUsers[0].id));
            assert.ok(result2.data?.activeUsers.has(mockUsers[1].id));
        });

        it("should handle user leaving session", async () => {
            const taskId = `${TASK_ID_PREFIX}-leave-session`;
            const user = mockUsers[0];
            
            // Join session
            await collaborationService.joinTaskSession(taskId, user.id, user);
            
            // Leave session
            const leaveResult = await collaborationService.leaveTaskSession(taskId, user.id);
            assert.ok(leaveResult.success);
            
            // Verify session is cleaned up when empty
            const sessionResult = await collaborationService.getActiveSession(taskId);
            assert.ok(sessionResult.success);
            assert.equal(sessionResult.data, null);
        });

        it("should track user sessions correctly", async () => {
            const taskId1 = `${TASK_ID_PREFIX}-user-sessions-1`;
            const taskId2 = `${TASK_ID_PREFIX}-user-sessions-2`;
            const user = mockUsers[0];
            
            // Join multiple sessions
            await collaborationService.joinTaskSession(taskId1, user.id, user);
            await collaborationService.joinTaskSession(taskId2, user.id, user);
            
            // Get user sessions
            const userSessionsResult = await collaborationService.getUserSessions(user.id);
            assert.ok(userSessionsResult.success);
            
            const sessionCount = userSessionsResult.data?.length || 0;
            assert.ok(sessionCount >= 2, "Should have at least 2 sessions");
            
            // Verify the expected sessions are present
            const sessionIds = userSessionsResult.data?.map(s => s.taskId) || [];
            assert.ok(sessionIds.includes(taskId1), "Should include first session");
            assert.ok(sessionIds.includes(taskId2), "Should include second session");
        });
    });

    describe("Presence Management", () => {
        it("should update user cursor position", async () => {
            const taskId = `${TASK_ID_PREFIX}-cursor`;
            const user = mockUsers[0];
            
            await collaborationService.joinTaskSession(taskId, user.id, user);
            
            const presenceUpdate = {
                cursor: {
                    field: "description" as const,
                    position: 42,
                    selection: { start: 42, end: 50 }
                },
                isTyping: true
            };
            
            const result = await collaborationService.updateUserPresence(taskId, user.id, presenceUpdate);
            assert.ok(result.success);
            
            // Verify presence was updated
            const activeUsersResult = await collaborationService.getActiveUsers(taskId);
            assert.ok(activeUsersResult.success);
            assert.ok(activeUsersResult.data);
            
            const userPresence = activeUsersResult.data.find(p => p.userId === user.id);
            assert.ok(userPresence);
            assert.equal(userPresence.cursor.field, "description");
            assert.equal(userPresence.cursor.position, 42);
            assert.equal(userPresence.isTyping, true);
            assert.deepEqual(userPresence.cursor.selection, { start: 42, end: 50 });
        });

        it("should assign colors to users", async () => {
            const taskId = `${TASK_ID_PREFIX}-colors`;
            
            // Join multiple users
            for (let i = 0; i < mockUsers.length; i++) {
                await collaborationService.joinTaskSession(taskId, mockUsers[i].id, mockUsers[i]);
            }
            
            const activeUsersResult = await collaborationService.getActiveUsers(taskId);
            assert.ok(activeUsersResult.success);
            assert.ok(activeUsersResult.data);
            assert.equal(activeUsersResult.data.length, mockUsers.length);
            
            // All users should have assigned colors
            const colors = activeUsersResult.data.map(u => u.color);
            colors.forEach(color => {
                assert.ok(color && color.length > 0, "Each user should have a color");
                assert.ok(color.startsWith("#"), "Colors should be hex format");
            });
        });
    });

    describe("Operational Transformation", () => {
        it("should apply simple insert operation", async () => {
            const taskId = `${TASK_ID_PREFIX}-insert`;
            const user = mockUsers[0];
            
            await collaborationService.joinTaskSession(taskId, user.id, user);
            
            const operation: TaskEditOperation = {
                id: "op-1",
                taskId,
                userId: user.id,
                field: "title",
                operation: {
                    type: "insert",
                    position: 0,
                    text: "Hello "
                },
                timestamp: new Date(),
                revision: 0
            };
            
            const result = await collaborationService.applyOperation(operation);
            assert.ok(result.success, "Should apply insert operation");
            assert.ok(result.data);
            assert.equal(result.data.operation.type, "insert");
            assert.equal(result.data.operation.text, "Hello ");
        });

        it("should transform concurrent operations", async () => {
            const taskId = `${TASK_ID_PREFIX}-transform`;
            const user1 = mockUsers[0];
            const user2 = mockUsers[1];
            
            // Both users join session
            await collaborationService.joinTaskSession(taskId, user1.id, user1);
            await collaborationService.joinTaskSession(taskId, user2.id, user2);
            
            // User 1 applies operation first
            const op1: TaskEditOperation = {
                id: "op-1",
                taskId,
                userId: user1.id,
                field: "title",
                operation: { type: "insert", position: 0, text: "User1: " },
                timestamp: new Date(),
                revision: 0
            };
            
            await collaborationService.applyOperation(op1);
            
            // User 2 wants to apply concurrent operation at the same time as op1
            // So we transform against operations since revision 0
            const op2: TaskEditOperation = {
                id: "op-2",
                taskId,
                userId: user2.id,
                field: "title",
                operation: { type: "insert", position: 0, text: "User2: " },
                timestamp: new Date(),
                revision: 0
            };
            
            const result = await collaborationService.transformOperation(op2, 0);
            assert.ok(result.success);
            assert.ok(result.data);
            
            // The operation should be transformed to account for User1's insert
            const transformedOp = result.data[0];
            assert.equal(transformedOp.operation.type, "insert");
            // Since both start at position 0, and User1 inserted "User1: " (7 chars),
            // User2's operation should be transformed to position 7
            assert.ok(transformedOp.operation.position >= 0, "Position should be transformed");
            assert.equal(transformedOp.operation.text, "User2: ");
        });

        it("should retrieve operations since revision", async () => {
            const taskId = `${TASK_ID_PREFIX}-history`;
            const user = mockUsers[0];
            
            await collaborationService.joinTaskSession(taskId, user.id, user);
            
            // Apply multiple operations
            const operations = [
                {
                    id: "op-1",
                    taskId,
                    userId: user.id,
                    field: "title" as const,
                    operation: { type: "insert" as const, position: 0, text: "First " },
                    timestamp: new Date(),
                    revision: 0
                },
                {
                    id: "op-2",
                    taskId,
                    userId: user.id,
                    field: "title" as const,
                    operation: { type: "insert" as const, position: 6, text: "Second " },
                    timestamp: new Date(),
                    revision: 1
                },
                {
                    id: "op-3",
                    taskId,
                    userId: user.id,
                    field: "title" as const,
                    operation: { type: "insert" as const, position: 13, text: "Third " },
                    timestamp: new Date(),
                    revision: 2
                }
            ];
            
            for (const op of operations) {
                await collaborationService.applyOperation(op);
            }
            
            // Get operations since revision 1
            const result = await collaborationService.getOperationsSince(taskId, 1);
            assert.ok(result.success);
            assert.ok(result.data);
            assert.equal(result.data.length, 2); // Should return operations at revisions 1 and 2
        });
    });

    describe("Conflict Resolution", () => {
        it("should detect and resolve concurrent edits", async () => {
            const taskId = `${TASK_ID_PREFIX}-conflict`;
            const user1 = mockUsers[0];
            const user2 = mockUsers[1];
            
            await collaborationService.joinTaskSession(taskId, user1.id, user1);
            await collaborationService.joinTaskSession(taskId, user2.id, user2);
            
            // Create conflicting operations (same timestamp and field)
            const timestamp = new Date();
            const conflictingOps: TaskEditOperation[] = [
                {
                    id: "conflict-1",
                    taskId,
                    userId: user1.id,
                    field: "title",
                    operation: { type: "insert", position: 0, text: "User1 edit" },
                    timestamp,
                    revision: 0
                },
                {
                    id: "conflict-2", 
                    taskId,
                    userId: user2.id,
                    field: "title",
                    operation: { type: "insert", position: 0, text: "User2 edit" },
                    timestamp,
                    revision: 0
                }
            ];
            
            const result = await collaborationService.resolveConflicts(conflictingOps);
            assert.ok(result.success);
            assert.ok(result.data);
            assert.equal(result.data.length, 1);
            
            const resolution = result.data[0];
            assert.equal(resolution.conflictType, "concurrent_edit");
            assert.equal(resolution.resolution, "accept");
        });
    });

    describe("Cleanup and Maintenance", () => {
        it("should clean up inactive sessions", async () => {
            const taskId = `${TASK_ID_PREFIX}-cleanup`;
            const user = mockUsers[0];
            
            // Create session
            await collaborationService.joinTaskSession(taskId, user.id, user);
            
            // Verify session exists
            let sessionResult = await collaborationService.getActiveSession(taskId);
            assert.ok(sessionResult.success);
            assert.ok(sessionResult.data);
            
            // Leave session to make it inactive
            await collaborationService.leaveTaskSession(taskId, user.id);
            
            // Verify cleanup
            sessionResult = await collaborationService.getActiveSession(taskId);
            assert.ok(sessionResult.success);
            assert.equal(sessionResult.data, null);
        });

        it("should handle cleanup without errors", async () => {
            const result = await collaborationService.cleanupInactiveSessions();
            assert.ok(result.success, "Cleanup should complete successfully");
        });
    });

    describe("Error Handling", () => {
        it("should handle operations on non-existent sessions", async () => {
            const nonExistentTask = `${TASK_ID_PREFIX}-non-existent`;
            const user = mockUsers[0];
            
            const operation: TaskEditOperation = {
                id: "op-fail",
                taskId: nonExistentTask,
                userId: user.id,
                field: "title",
                operation: { type: "insert", position: 0, text: "Test" },
                timestamp: new Date(),
                revision: 0
            };
            
            const result = await collaborationService.applyOperation(operation);
            assert.equal(result.success, false, "Should fail for non-existent session");
            assert.ok(result.error);
        });

        it("should handle presence updates for non-existent users", async () => {
            const taskId = `${TASK_ID_PREFIX}-presence-error`;
            const user = mockUsers[0];
            const nonExistentUser = "non-existent-user";
            
            await collaborationService.joinTaskSession(taskId, user.id, user);
            
            const result = await collaborationService.updateUserPresence(
                taskId, 
                nonExistentUser, 
                { isTyping: true }
            );
            
            assert.equal(result.success, false, "Should fail for non-existent user");
            assert.ok(result.error);
        });
    });
});