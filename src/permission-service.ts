import type { Permission, RolePermissions, UserPermissions, UserRole } from "./types.ts";

type PermissionContext = {
	userRole?: string;
	taskAssignedTo?: string;
	taskStatus?: string;
	taskPriority?: string;
	[key: string]: unknown;
};

export class PermissionService {
	private rolePermissions: RolePermissions;

	constructor() {
		this.rolePermissions = {
			admin: [
				// User management
				{ resource: "users", action: "create" },
				{ resource: "users", action: "read" },
				{ resource: "users", action: "update" },
				{ resource: "users", action: "delete" },
				{ resource: "users", action: "manage_sessions" },

				// Task management
				{ resource: "tasks", action: "create" },
				{ resource: "tasks", action: "read" },
				{ resource: "tasks", action: "update" },
				{ resource: "tasks", action: "delete" },
				{ resource: "tasks", action: "assign_any" },
				{ resource: "tasks", action: "view_all" },

				// Template management
				{ resource: "templates", action: "create" },
				{ resource: "templates", action: "read" },
				{ resource: "templates", action: "update" },
				{ resource: "templates", action: "delete" },

				// Automation rules
				{ resource: "automation", action: "create" },
				{ resource: "automation", action: "read" },
				{ resource: "automation", action: "update" },
				{ resource: "automation", action: "delete" },
				{ resource: "automation", action: "execute" },

				// System management
				{ resource: "system", action: "manage" },
				{ resource: "system", action: "view_logs" },
				{ resource: "system", action: "backup" },
				{ resource: "system", action: "restore" },

				// Analytics and reports
				{ resource: "analytics", action: "read" },
				{ resource: "reports", action: "create" },
				{ resource: "reports", action: "read" },
				{ resource: "reports", action: "export" },

				// Settings
				{ resource: "settings", action: "read" },
				{ resource: "settings", action: "update" },
			],

			manager: [
				// User management (limited)
				{ resource: "users", action: "read" },
				{
					resource: "users",
					action: "update",
					conditions: { role: ["developer", "viewer"] },
				},

				// Task management
				{ resource: "tasks", action: "create" },
				{ resource: "tasks", action: "read" },
				{ resource: "tasks", action: "update" },
				{ resource: "tasks", action: "delete" },
				{ resource: "tasks", action: "assign_team" },
				{ resource: "tasks", action: "view_all" },

				// Template management
				{ resource: "templates", action: "create" },
				{ resource: "templates", action: "read" },
				{ resource: "templates", action: "update" },
				{ resource: "templates", action: "delete" },

				// Automation rules (limited)
				{ resource: "automation", action: "read" },
				{ resource: "automation", action: "update" },
				{ resource: "automation", action: "execute" },

				// Analytics and reports
				{ resource: "analytics", action: "read" },
				{ resource: "reports", action: "create" },
				{ resource: "reports", action: "read" },
				{ resource: "reports", action: "export" },

				// Settings (limited)
				{ resource: "settings", action: "read" },
			],

			developer: [
				// Task management
				{ resource: "tasks", action: "create" },
				{ resource: "tasks", action: "read" },
				{
					resource: "tasks",
					action: "update",
					conditions: { can_update_task: true },
				},
				{
					resource: "tasks",
					action: "delete",
					conditions: { created_by_self: true },
				},
				{ resource: "tasks", action: "assign_self" },

				// Template management (read-only)
				{ resource: "templates", action: "read" },

				// Automation rules (read-only)
				{ resource: "automation", action: "read" },

				// Basic analytics
				{
					resource: "analytics",
					action: "read",
					conditions: { own_tasks_only: true },
				},

				// Profile management
				{ resource: "profile", action: "read" },
				{ resource: "profile", action: "update" },
			],

			viewer: [
				// Task management (read-only)
				{
					resource: "tasks",
					action: "read",
					conditions: { assigned_to_self: true },
				},

				// Template management (read-only)
				{ resource: "templates", action: "read" },

				// Automation rules (read-only)
				{ resource: "automation", action: "read" },

				// Basic analytics (own tasks only)
				{
					resource: "analytics",
					action: "read",
					conditions: { own_tasks_only: true },
				},

				// Profile management
				{ resource: "profile", action: "read" },
				{ resource: "profile", action: "update" },
			],
		};
	}

	getRolePermissions(role: UserRole): Permission[] {
		return this.rolePermissions[role] || [];
	}

	getUserPermissions(
		userId: string,
		role: UserRole,
		customPermissions?: Permission[],
	): UserPermissions {
		const rolePermissions = this.getRolePermissions(role);

		return {
			userId,
			role,
			permissions: rolePermissions,
			customPermissions: customPermissions || [],
		};
	}

	async hasPermission(
		userPermissions: UserPermissions,
		resource: string,
		action: string,
		context?: PermissionContext,
	): Promise<boolean> {
		// Check role permissions first
		const rolePermission = userPermissions.permissions.find(
			(p) => p.resource === resource && p.action === action,
		);

		// Check custom permissions
		const customPermission = userPermissions.customPermissions?.find(
			(p) => p.resource === resource && p.action === action,
		);

		const permission = rolePermission || customPermission;
		if (!permission) {
			return false;
		}

		// If there are no conditions, permission is granted
		if (!permission.conditions || Object.keys(permission.conditions).length === 0) {
			return true;
		}

		// Evaluate conditions
		return this.evaluateConditions(permission.conditions, context || {});
	}

	private evaluateConditions(
		conditions: Record<string, unknown>,
		context: PermissionContext,
	): boolean {
		for (const [key, value] of Object.entries(conditions)) {
			switch (key) {
				case "role":
					if (Array.isArray(value) && !value.includes(context.userRole)) {
						return false;
					}
					break;

				case "assigned_to_self":
					if (value && context.taskAssignedTo !== context.userId) {
						return false;
					}
					break;

				case "created_by_self":
					if (value && context.taskCreatedBy !== context.userId) {
						return false;
					}
					break;

				case "can_update_task":
					if (
						value &&
						context.taskCreatedBy !== context.userId &&
						context.taskAssignedTo !== context.userId
					) {
						return false;
					}
					break;

				case "own_tasks_only":
					if (
						value &&
						context.taskAssignedTo !== context.userId &&
						context.taskCreatedBy !== context.userId
					) {
						return false;
					}
					break;

				case "team_member":
					if (
						value &&
						!this.isTeamMember(context.userId, context.taskAssignedTo, context.teamMembers)
					) {
						return false;
					}
					break;

				default:
					console.warn(`[PERMISSION-SERVICE] Unknown condition: ${key}`);
					break;
			}
		}

		return true;
	}

	private isTeamMember(userId: string, targetUserId: string, teamMembers?: string[]): boolean {
		if (!teamMembers) return false;
		return teamMembers.includes(userId) && teamMembers.includes(targetUserId);
	}

	getAvailableResources(): string[] {
		const resources = new Set<string>();

		for (const permissions of Object.values(this.rolePermissions)) {
			for (const permission of permissions) {
				resources.add(permission.resource);
			}
		}

		return Array.from(resources).sort();
	}

	getAvailableActions(resource: string): string[] {
		const actions = new Set<string>();

		for (const permissions of Object.values(this.rolePermissions)) {
			for (const permission of permissions) {
				if (permission.resource === resource) {
					actions.add(permission.action);
				}
			}
		}

		return Array.from(actions).sort();
	}

	getPermissionMatrix(): Record<UserRole, Record<string, string[]>> {
		const matrix: Record<UserRole, Record<string, string[]>> = {
			admin: {},
			manager: {},
			developer: {},
			viewer: {},
		};

		const roles: UserRole[] = ["admin", "manager", "developer", "viewer"];

		for (const role of roles) {
			const permissions = this.rolePermissions[role];
			matrix[role] = {};

			for (const permission of permissions) {
				if (!matrix[role][permission.resource]) {
					matrix[role][permission.resource] = [];
				}
				const resourceActions = matrix[role][permission.resource];
				if (resourceActions) {
					resourceActions.push(permission.action);
				}
			}
		}

		return matrix;
	}

	validatePermission(permission: Permission): {
		isValid: boolean;
		error?: string;
	} {
		const validResources = this.getAvailableResources();
		const validActions = this.getAvailableActions(permission.resource);

		if (!validResources.includes(permission.resource)) {
			return {
				isValid: false,
				error: `Invalid resource: ${permission.resource}`,
			};
		}

		if (!validActions.includes(permission.action)) {
			return {
				isValid: false,
				error: `Invalid action for resource ${permission.resource}: ${permission.action}`,
			};
		}

		return { isValid: true };
	}

	addCustomPermission(userPermissions: UserPermissions, permission: Permission): UserPermissions {
		const validation = this.validatePermission(permission);
		if (!validation.isValid) {
			throw new Error(validation.error);
		}

		return {
			...userPermissions,
			customPermissions: [...(userPermissions.customPermissions || []), permission],
		};
	}

	removeCustomPermission(
		userPermissions: UserPermissions,
		resource: string,
		action: string,
	): UserPermissions {
		if (!userPermissions.customPermissions) {
			return userPermissions;
		}

		return {
			...userPermissions,
			customPermissions: userPermissions.customPermissions.filter(
				(p) => !(p.resource === resource && p.action === action),
			),
		};
	}
}
