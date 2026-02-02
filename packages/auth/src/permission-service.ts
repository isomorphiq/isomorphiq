import type { Permission, RolePermissions, UserPermissions } from "./security-types.ts";
import type { UserRole } from "./types.ts";

type PermissionContext = {
	userRole?: string;
	taskAssignedTo?: string;
	taskCreatedBy?: string;
	taskStatus?: string;
	teamMembers?: string[];
	userId?: string;
};

type PermissionInput = {
	resource: string;
	action: string;
	conditions?: Array<{ field: string; value: unknown }>;
};

const buildPermission = (input: PermissionInput): Permission => ({
	id: `${input.resource}:${input.action}`,
	name: `${input.resource}:${input.action}`,
	description: `${input.action} on ${input.resource}`,
	category: input.resource,
	resource: input.resource,
	action: input.action,
	riskLevel: "low",
	requiresApproval: false,
	conditions: input.conditions?.map((c) => ({
		field: c.field,
		operator: "equals",
		value: c.value,
		description: `${c.field} must equal ${String(c.value)}`,
	})),
});

const buildPermissions = (inputs: PermissionInput[]): Permission[] =>
	inputs.map((p) => buildPermission(p));

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PermissionService {
	private rolePermissions: RolePermissions;

	constructor() {
		this.rolePermissions = {
			admin: buildPermissions([
				{ resource: "users", action: "create" },
				{ resource: "users", action: "read" },
				{ resource: "users", action: "update" },
				{ resource: "users", action: "delete" },
				{ resource: "users", action: "manage_sessions" },
				{ resource: "tasks", action: "create" },
				{ resource: "tasks", action: "read" },
				{ resource: "tasks", action: "update" },
				{ resource: "tasks", action: "delete" },
				{ resource: "tasks", action: "assign_any" },
				{ resource: "tasks", action: "view_all" },
				{ resource: "templates", action: "create" },
				{ resource: "templates", action: "read" },
				{ resource: "templates", action: "update" },
				{ resource: "templates", action: "delete" },
				{ resource: "automation", action: "create" },
				{ resource: "automation", action: "read" },
				{ resource: "automation", action: "update" },
				{ resource: "automation", action: "delete" },
				{ resource: "automation", action: "execute" },
				{ resource: "system", action: "manage" },
				{ resource: "system", action: "view_logs" },
				{ resource: "system", action: "backup" },
				{ resource: "system", action: "restore" },
				{ resource: "analytics", action: "read" },
				{ resource: "reports", action: "create" },
				{ resource: "reports", action: "read" },
				{ resource: "reports", action: "export" },
				{ resource: "settings", action: "read" },
				{ resource: "settings", action: "update" },
			]),
			manager: buildPermissions([
				{ resource: "users", action: "read" },
				{ resource: "users", action: "update", conditions: [{ field: "role", value: "limited" }] },
				{ resource: "tasks", action: "create" },
				{ resource: "tasks", action: "read" },
				{ resource: "tasks", action: "update" },
				{ resource: "tasks", action: "delete" },
				{ resource: "tasks", action: "assign_team" },
				{ resource: "tasks", action: "view_all" },
				{ resource: "templates", action: "create" },
				{ resource: "templates", action: "read" },
				{ resource: "templates", action: "update" },
				{ resource: "templates", action: "delete" },
				{ resource: "automation", action: "read" },
				{ resource: "automation", action: "update" },
				{ resource: "automation", action: "execute" },
				{ resource: "analytics", action: "read" },
				{ resource: "reports", action: "create" },
				{ resource: "reports", action: "read" },
				{ resource: "reports", action: "export" },
				{ resource: "settings", action: "read" },
			]),
			developer: buildPermissions([
				{ resource: "tasks", action: "create" },
				{ resource: "tasks", action: "read" },
				{ resource: "tasks", action: "update", conditions: [{ field: "scope", value: "can_update_task" }] },
				{ resource: "tasks", action: "delete", conditions: [{ field: "scope", value: "created_by_self" }] },
				{ resource: "tasks", action: "assign_self" },
				{ resource: "templates", action: "read" },
				{ resource: "automation", action: "read" },
				{ resource: "analytics", action: "read", conditions: [{ field: "scope", value: "own_tasks_only" }] },
				{ resource: "profile", action: "read" },
				{ resource: "profile", action: "update" },
			]),
			viewer: buildPermissions([
				{ resource: "tasks", action: "read", conditions: [{ field: "scope", value: "assigned_to_self" }] },
				{ resource: "templates", action: "read" },
				{ resource: "automation", action: "read" },
				{ resource: "analytics", action: "read", conditions: [{ field: "scope", value: "own_tasks_only" }] },
				{ resource: "profile", action: "read" },
				{ resource: "profile", action: "update" },
			]),
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
		const permission =
			userPermissions.permissions.find((p) => p.resource === resource && p.action === action) ||
			userPermissions.customPermissions?.find((p) => p.resource === resource && p.action === action);

		if (!permission) return false;
		if (!permission.conditions || permission.conditions.length === 0) return true;
		return this.evaluateConditions(permission.conditions, context || {});
	}

	private evaluateConditions(conditions: Permission["conditions"], context: PermissionContext): boolean {
		if (!conditions) return true;
		for (const condition of conditions) {
			switch (condition.field) {
				case "role":
					if (condition.value && condition.value !== context.userRole) return false;
					break;
				case "scope":
					if (condition.value === "assigned_to_self" && context.taskAssignedTo !== context.userId) {
						return false;
					}
					if (condition.value === "created_by_self" && context.taskCreatedBy !== context.userId) {
						return false;
					}
					if (condition.value === "own_tasks_only") {
						if (
							context.taskAssignedTo !== context.userId &&
							context.taskCreatedBy !== context.userId
						) {
							return false;
						}
					}
					if (condition.value === "can_update_task" && context.taskStatus === "done") {
						return false;
					}
					break;
				default:
					break;
			}
		}
		return true;
	}

	getPermissionMatrix(): RolePermissions {
		return this.rolePermissions;
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
}

