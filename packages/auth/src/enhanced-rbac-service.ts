import crypto from "node:crypto";
import path from "node:path";
import { Level } from "level";
import type {
    EnhancedRole,
    Permission,
    PermissionCondition,
    RoleConstraint,
} from "./security-types.ts";

type RbacContext = Record<string, unknown>;
type ConstraintConditions = Record<string, unknown>;

export class EnhancedRbacService {
	private rolesDb!: Level<string, EnhancedRole>;
	private permissionsDb!: Level<string, Permission>;
	private userRoleAssignmentsDb!: Level<string, string[]>; // userId -> roleIds
	private dbReady = false;

	constructor() {
		const rolesDbPath = path.join(process.cwd(), "db", "enhanced-roles");
		const permissionsDbPath = path.join(process.cwd(), "db", "permissions");
		const userRoleAssignmentsDbPath = path.join(process.cwd(), "db", "user-role-assignments");

		this.rolesDb = new Level(rolesDbPath, { valueEncoding: "json" });
		this.permissionsDb = new Level(permissionsDbPath, { valueEncoding: "json" });
		this.userRoleAssignmentsDb = new Level(userRoleAssignmentsDbPath, { valueEncoding: "json" });
	}

	private async ensureDatabasesOpen(): Promise<void> {
		if (!this.dbReady) {
			try {
				await this.rolesDb.open();
				await this.permissionsDb.open();
				await this.userRoleAssignmentsDb.open();
				this.dbReady = true;
				console.log("[ENHANCED-RBAC] Enhanced RBAC databases opened successfully");
			} catch (error) {
				console.error("[ENHANCED-RBAC] Failed to open databases:", error);
				throw error;
			}
		}
	}

	// Initialize default enhanced roles and permissions
	async initializeDefaultRolesAndPermissions(): Promise<void> {
		await this.ensureDatabasesOpen();

		// Create default permissions
		const defaultPermissions: Permission[] = [
			// User Management
			{
				id: "user-create",
				name: "Create Users",
				resource: "users",
				action: "create",
				description: "Create new user accounts",
				category: "User Management",
				riskLevel: "high",
				requiresApproval: true,
			},
			{
				id: "user-read",
				name: "Read Users",
				resource: "users",
				action: "read",
				description: "View user information",
				category: "User Management",
				riskLevel: "medium",
				requiresApproval: false,
			},
			{
				id: "user-update",
				name: "Update Users",
				resource: "users",
				action: "update",
				description: "Modify user accounts",
				category: "User Management",
				riskLevel: "high",
				requiresApproval: true,
			},
			{
				id: "user-delete",
				name: "Delete Users",
				resource: "users",
				action: "delete",
				description: "Delete user accounts",
				category: "User Management",
				riskLevel: "critical",
				requiresApproval: true,
			},

			// Task Management
			{
				id: "task-create",
				name: "Create Tasks",
				resource: "tasks",
				action: "create",
				description: "Create new tasks",
				category: "Task Management",
				riskLevel: "low",
				requiresApproval: false,
			},
			{
				id: "task-read",
				name: "Read Tasks",
				resource: "tasks",
				action: "read",
				description: "View task information",
				category: "Task Management",
				riskLevel: "low",
				requiresApproval: false,
			},
			{
				id: "task-update",
				name: "Update Tasks",
				resource: "tasks",
				action: "update",
				description: "Modify task information",
				category: "Task Management",
				riskLevel: "medium",
				requiresApproval: false,
				conditions: [
					{
						field: "assignedTo",
						operator: "equals",
						value: "currentUser",
						description: "Users can only update tasks assigned to them",
					},
				],
			},
			{
				id: "task-delete",
				name: "Delete Tasks",
				resource: "tasks",
				action: "delete",
				description: "Delete tasks",
				category: "Task Management",
				riskLevel: "high",
				requiresApproval: true,
			},
			{
				id: "task-assign-any",
				name: "Assign Any Task",
				resource: "tasks",
				action: "assign_any",
				description: "Assign tasks to any user",
				category: "Task Management",
				riskLevel: "medium",
				requiresApproval: false,
			},

			// Security Management
			{
				id: "security-view-logs",
				name: "View Security Logs",
				resource: "security",
				action: "view_logs",
				description: "Access security audit logs",
				category: "Security",
				riskLevel: "high",
				requiresApproval: false,
			},
			{
				id: "security-manage",
				name: "Manage Security",
				resource: "security",
				action: "manage",
				description: "Manage security policies and settings",
				category: "Security",
				riskLevel: "critical",
				requiresApproval: true,
			},

			// System Management
			{
				id: "system-backup",
				name: "System Backup",
				resource: "system",
				action: "backup",
				description: "Create system backups",
				category: "System",
				riskLevel: "medium",
				requiresApproval: false,
			},
			{
				id: "system-restore",
				name: "System Restore",
				resource: "system",
				action: "restore",
				description: "Restore system from backup",
				category: "System",
				riskLevel: "critical",
				requiresApproval: true,
			},
		];

		// Create default enhanced roles
		const defaultRoles: EnhancedRole[] = [
			{
				id: "enhanced-admin",
				name: "Enhanced Administrator",
				description: "Full system access with enhanced security controls",
				permissions: defaultPermissions,
				constraints: [
					{
						type: "time_based",
						conditions: {
							allowedHours: { start: 0, end: 24 }, // 24/7 access
							requireMfa: true,
						},
						description: "Admin access requires MFA and is available 24/7",
					},
				],
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: "enhanced-manager",
				name: "Enhanced Manager",
				description: "Team management with task oversight capabilities",
				permissions: defaultPermissions.filter(
					(p) =>
						!p.id.includes("delete") &&
						!p.id.includes("security-manage") &&
						!p.id.includes("system-restore"),
				),
				constraints: [
					{
						type: "time_based",
						conditions: {
							allowedHours: { start: 6, end: 22 }, // Business hours
							requireMfa: false,
						},
						description: "Manager access available during business hours",
					},
				],
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: "enhanced-developer",
				name: "Enhanced Developer",
				description: "Development tasks with self-service capabilities",
				permissions: defaultPermissions.filter(
					(p) => p.category === "Task Management" || p.id === "user-read",
				),
				constraints: [
					{
						type: "context_based",
						conditions: {
							canUpdateOwnTasks: true,
							canCreateTasks: true,
							maxTasksPerDay: 10,
						},
						description: "Developers can manage their own tasks with daily limits",
					},
				],
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: "enhanced-viewer",
				name: "Enhanced Viewer",
				description: "Read-only access with limited capabilities",
				permissions: defaultPermissions.filter(
					(p) => p.action === "read" || p.id === "task-create",
				),
				constraints: [
					{
						type: "ip_based",
						conditions: {
							allowedNetworks: ["10.0.0.0/8", "192.168.0.0/16"], // Private networks
						},
						description: "Viewer access restricted to private networks",
					},
				],
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		];

		try {
			// Save permissions
			for (const permission of defaultPermissions) {
				await this.permissionsDb.put(permission.id, permission);
			}

			// Save roles
			for (const role of defaultRoles) {
				await this.rolesDb.put(role.id, role);
			}

			console.log("[ENHANCED-RBAC] Default enhanced roles and permissions initialized");
		} catch (error) {
			console.error("[ENHANCED-RBAC] Failed to initialize default roles:", error);
			throw error;
		}
	}

	// Role Management
	async createRole(
		roleData: Omit<EnhancedRole, "id" | "createdAt" | "updatedAt">,
	): Promise<EnhancedRole> {
		await this.ensureDatabasesOpen();

		const id = `role-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
		const role: EnhancedRole = {
			...roleData,
			id,
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		try {
			await this.rolesDb.put(id, role);
			console.log(`[ENHANCED-RBAC] Created enhanced role: ${role.name}`);
			return role;
		} catch (error) {
			console.error("[ENHANCED-RBAC] Failed to create role:", error);
			throw error;
		}
	}

	async getAllRoles(): Promise<EnhancedRole[]> {
		await this.ensureDatabasesOpen();

		const roles: EnhancedRole[] = [];
		try {
			const iterator = this.rolesDb.iterator();
			for await (const [, value] of iterator) {
				roles.push(value);
			}
			await iterator.close();
		} catch (error) {
			console.error("[ENHANCED-RBAC] Error reading roles:", error);
		}

		return roles;
	}

	async getRole(id: string): Promise<EnhancedRole | null> {
		await this.ensureDatabasesOpen();
		try {
			return await this.rolesDb.get(id);
		} catch (_error) {
			void _error;
			return null;
		}
	}

	async updateRole(id: string, updates: Partial<EnhancedRole>): Promise<EnhancedRole> {
		await this.ensureDatabasesOpen();

		const role = await this.rolesDb.get(id);
		if (!role) {
			throw new Error("Role not found");
		}

		const updatedRole: EnhancedRole = {
			...role,
			...updates,
			updatedAt: new Date(),
		};

		try {
			await this.rolesDb.put(id, updatedRole);
			console.log(`[ENHANCED-RBAC] Updated enhanced role: ${updatedRole.name}`);
			return updatedRole;
		} catch (error) {
			console.error("[ENHANCED-RBAC] Failed to update role:", error);
			throw error;
		}
	}

	async deleteRole(id: string): Promise<void> {
		await this.ensureDatabasesOpen();

		const role = await this.rolesDb.get(id);
		if (!role) {
			throw new Error("Role not found");
		}

		try {
			await this.rolesDb.del(id);
			console.log(`[ENHANCED-RBAC] Deleted enhanced role: ${role.name}`);
		} catch (error) {
			console.error("[ENHANCED-RBAC] Failed to delete role:", error);
			throw error;
		}
	}

	// Permission Management
	async getAllPermissions(): Promise<Permission[]> {
		await this.ensureDatabasesOpen();

		const permissions: Permission[] = [];
		try {
			const iterator = this.permissionsDb.iterator();
			for await (const [, value] of iterator) {
				permissions.push(value);
			}
			await iterator.close();
		} catch (error) {
			console.error("[ENHANCED-RBAC] Error reading permissions:", error);
		}

		return permissions;
	}

	async getPermission(id: string): Promise<Permission | null> {
		await this.ensureDatabasesOpen();
		try {
			return await this.permissionsDb.get(id);
		} catch (_error) {
			void _error;
			return null;
		}
	}

	// User Role Assignment
	async assignRoleToUser(userId: string, roleId: string): Promise<void> {
		await this.ensureDatabasesOpen();

		try {
			const currentAssignments = await this.getUserRoleAssignments(userId);
			const updatedAssignments = [...new Set([...(currentAssignments || []), roleId])];
			await this.userRoleAssignmentsDb.put(userId, updatedAssignments);
			console.log(`[ENHANCED-RBAC] Assigned role ${roleId} to user ${userId}`);
		} catch (error) {
			console.error("[ENHANCED-RBAC] Failed to assign role:", error);
			throw error;
		}
	}

	async removeRoleFromUser(userId: string, roleId: string): Promise<void> {
		await this.ensureDatabasesOpen();

		try {
			const currentAssignments = await this.getUserRoleAssignments(userId);
			const updatedAssignments = currentAssignments.filter((id) => id !== roleId);
			await this.userRoleAssignmentsDb.put(userId, updatedAssignments);
			console.log(`[ENHANCED-RBAC] Removed role ${roleId} from user ${userId}`);
		} catch (error) {
			console.error("[ENHANCED-RBAC] Failed to remove role:", error);
			throw error;
		}
	}

	async getUserRoleAssignments(userId: string): Promise<string[]> {
		await this.ensureDatabasesOpen();
		try {
			return await this.userRoleAssignmentsDb.get(userId);
		} catch (_error) {
			void _error;
			return [];
		}
	}

	// Enhanced Permission Checking
	async checkPermission(
		userId: string,
		resource: string,
		action: string,
		context?: RbacContext,
	): Promise<{
		granted: boolean;
		role?: EnhancedRole | undefined;
		permission?: Permission | undefined;
		constraints?: RoleConstraint[] | undefined;
		reason?: string | undefined;
	}> {
		await this.ensureDatabasesOpen();

		try {
			const userRoleIds = await this.getUserRoleAssignments(userId);
			if (userRoleIds.length === 0) {
				return { granted: false, reason: "No roles assigned to user" };
			}

			// Check each role for the required permission
			for (const roleId of userRoleIds) {
				const role = await this.getRole(roleId);
				if (!role || !role.isActive) {
					continue;
				}

				// Find matching permission in this role
				const permission = role.permissions.find(
					(p) => p.resource === resource && p.action === action,
				);

				if (permission) {
					// Check role constraints
					const constraintResult = await this.evaluateRoleConstraints(
						role.constraints || [],
						context || {},
						userId,
					);

					if (constraintResult.satisfied) {
						// Check permission conditions
						const conditionResult = await this.evaluatePermissionConditions(
							permission.conditions || [],
							context || {},
						);

						if (conditionResult.satisfied) {
							return {
								granted: true,
								role: role || undefined,
								permission: permission || undefined,
								constraints: role.constraints || undefined,
							};
						} else {
							return {
								granted: false,
								role: role || undefined,
								permission: permission || undefined,
								reason: conditionResult.reason,
							};
						}
					} else {
						return {
							granted: false,
							role: role || undefined,
							permission: permission || undefined,
							reason: constraintResult.reason,
						};
					}
				}
			}

			return { granted: false, reason: "Permission not found in any assigned role" };
		} catch (error) {
			console.error("[ENHANCED-RBAC] Error checking permission:", error);
			return { granted: false, reason: "Error checking permission" };
		}
	}

	private async evaluateRoleConstraints(
		constraints: RoleConstraint[],
		context: RbacContext,
		userId: string,
	): Promise<{ satisfied: boolean; reason?: string }> {
		for (const constraint of constraints) {
			switch (constraint.type) {
				case "time_based":
					if (!this.evaluateTimeConstraint(constraint.conditions, context)) {
						return {
							satisfied: false,
							reason: "Access outside allowed time window",
						};
					}
					break;

				case "ip_based":
					if (!this.evaluateIpConstraint(constraint.conditions, context)) {
						return {
							satisfied: false,
							reason: "Access from unauthorized IP address",
						};
					}
					break;

				case "location_based":
					if (!this.evaluateLocationConstraint(constraint.conditions, context)) {
						return {
							satisfied: false,
							reason: "Access from unauthorized location",
						};
					}
					break;

				case "device_based":
					if (!this.evaluateDeviceConstraint(constraint.conditions, context)) {
						return {
							satisfied: false,
							reason: "Access from unauthorized device",
						};
					}
					break;

				case "context_based":
					if (!this.evaluateContextConstraint(constraint.conditions, context, userId)) {
						return {
							satisfied: false,
							reason: "Context-based access denied",
						};
					}
					break;

				default:
					console.warn(`[ENHANCED-RBAC] Unknown constraint type: ${constraint.type}`);
					break;
			}
		}

		return { satisfied: true };
	}

	private evaluateTimeConstraint(conditions: ConstraintConditions, context: RbacContext): boolean {
		const now = new Date();
		const currentHour = now.getHours();

		const allowedHours = conditions.allowedHours as { start: number; end: number } | undefined;
		if (allowedHours) {
			if (currentHour < allowedHours.start || currentHour > allowedHours.end) {
				return false;
			}
		}

		if (conditions.requireMfa === true && context.mfaVerified !== true) {
			return false;
		}

		return true;
	}

	private evaluateIpConstraint(conditions: ConstraintConditions, context: RbacContext): boolean {
		const clientIp = context.ipAddress as string | undefined;
		const allowedNetworks = conditions.allowedNetworks as string[] | undefined;
		if (!clientIp || !allowedNetworks) {
			return true;
		}

		// Simple IP range checking (in production, use proper IP address libraries)
		return allowedNetworks.some((network: string) => {
			if (network.includes("/")) {
				// CIDR notation - simplified check
				const [baseIp, mask] = network.split("/");
				if (baseIp) {
					const baseIpParts = baseIp.split(".");
					return clientIp.startsWith(baseIpParts.slice(0, mask === "24" ? 3 : 2).join("."));
				}
				return false;
			} else {
				// Exact IP match
				return clientIp === network;
			}
		});
	}

	private evaluateLocationConstraint(
		conditions: ConstraintConditions,
		context: RbacContext,
	): boolean {
		const userLocation = context.location as { country?: string } | undefined;
		const allowedCountries = conditions.allowedCountries as string[] | undefined;
		if (!userLocation || !allowedCountries) {
			return true;
		}

		return userLocation.country ? allowedCountries.includes(userLocation.country) : true;
	}

	private evaluateDeviceConstraint(
		conditions: ConstraintConditions,
		context: RbacContext,
	): boolean {
		const deviceInfo = context.deviceInfo as { type?: string } | undefined;
		const allowedDevices = conditions.allowedDevices as string[] | undefined;
		if (!deviceInfo || !allowedDevices) {
			return true;
		}

		return deviceInfo.type ? allowedDevices.includes(deviceInfo.type) : true;
	}

	private evaluateContextConstraint(
		conditions: ConstraintConditions,
		context: RbacContext,
		userId: string,
	): boolean {
		if (conditions.canUpdateOwnTasks === true && context.taskOwnerId !== userId) {
			return false;
		}

		const maxTasksPerDay = conditions.maxTasksPerDay as number | undefined;
		const tasksCreatedToday = context.tasksCreatedToday as number | undefined;
		if (
			maxTasksPerDay !== undefined &&
			tasksCreatedToday !== undefined &&
			tasksCreatedToday >= maxTasksPerDay
		) {
			return false;
		}

		return true;
	}

	private async evaluatePermissionConditions(
		conditions: PermissionCondition[],
		context: RbacContext,
	): Promise<{ satisfied: boolean; reason?: string }> {
		for (const condition of conditions) {
			const contextValue = context[condition.field];
			const conditionValue = condition.value;
			let satisfied = false;

			switch (condition.operator) {
				case "equals":
					satisfied = contextValue === conditionValue;
					break;
				case "not_equals":
					satisfied = contextValue !== conditionValue;
					break;
				case "in":
					satisfied = Array.isArray(conditionValue) && conditionValue.includes(contextValue);
					break;
				case "not_in":
					satisfied = Array.isArray(conditionValue) && !conditionValue.includes(contextValue);
					break;
				case "contains":
					satisfied =
						typeof contextValue === "string" &&
						(typeof conditionValue === "string" ? contextValue.includes(conditionValue) : false);
					break;
				case "greater_than":
					satisfied = Number(contextValue) > Number(conditionValue);
					break;
				case "less_than":
					satisfied = Number(contextValue) < Number(conditionValue);
					break;
				default:
					console.warn(`[ENHANCED-RBAC] Unknown condition operator: ${condition.operator}`);
					satisfied = false;
					break;
			}

			if (!satisfied) {
				return {
					satisfied: false,
					reason: `Condition failed: ${condition.field} ${condition.operator} ${condition.value}`,
				};
			}
		}

		return { satisfied: true };
	}

	// Get user's effective permissions
	async getUserEffectivePermissions(userId: string): Promise<{
		roles: EnhancedRole[];
		permissions: Permission[];
		constraints: RoleConstraint[];
	}> {
		await this.ensureDatabasesOpen();

		const userRoleIds = await this.getUserRoleAssignments(userId);
		const roles: EnhancedRole[] = [];
		const permissions: Permission[] = [];
		const constraints: RoleConstraint[] = [];

		for (const roleId of userRoleIds) {
			const role = await this.getRole(roleId);
			if (role?.isActive) {
				roles.push(role);
				permissions.push(...role.permissions);
				if (role.constraints) {
					constraints.push(...role.constraints);
				}
			}
		}

		// Remove duplicate permissions
		const uniquePermissions = permissions.filter(
			(permission, index, arr) => arr.findIndex((p) => p.id === permission.id) === index,
		);

		return {
			roles,
			permissions: uniquePermissions,
			constraints,
		};
	}
}

// Singleton accessor
let sharedEnhancedRbacService: EnhancedRbacService | null = null;
export function getEnhancedRbacService(): EnhancedRbacService {
	if (!sharedEnhancedRbacService) {
		sharedEnhancedRbacService = new EnhancedRbacService();
	}
	return sharedEnhancedRbacService;
}
