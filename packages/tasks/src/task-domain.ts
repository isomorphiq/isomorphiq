import { z } from "zod";
import type { Result } from "@isomorphiq/core";
import { ValidationError } from "@isomorphiq/core";
import { struct } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import {
    CreateTaskInputSchema,
    type TaskPriority,
    TaskPrioritySchema,
    TaskSchema,
    type TaskStatus,
    TaskStatusSchema,
    TaskTypeSchema,
    UpdateTaskInputSchema,
} from "./types.ts";

export const TaskEntitySchema = TaskSchema;
export const TaskEntityStruct = struct.name("TaskEntity")<
    z.output<typeof TaskEntitySchema>,
    z.input<typeof TaskEntitySchema>
>(TaskEntitySchema);
export type TaskEntity = StructSelf<typeof TaskEntityStruct>;

export const CreateTaskInputWithPrioritySchema = CreateTaskInputSchema.extend({
    priority: TaskPrioritySchema.optional(),
    type: TaskTypeSchema.optional(),
});
export const CreateTaskInputWithPriorityStruct = struct.name("CreateTaskInputWithPriority")<
    z.output<typeof CreateTaskInputWithPrioritySchema>,
    z.input<typeof CreateTaskInputWithPrioritySchema>
>(CreateTaskInputWithPrioritySchema);
export type CreateTaskInputWithPriority = StructSelf<typeof CreateTaskInputWithPriorityStruct>;

export const ExtendedUpdateTaskInputSchema = UpdateTaskInputSchema;
export const ExtendedUpdateTaskInputStruct = struct.name("ExtendedUpdateTaskInput")<
    z.output<typeof ExtendedUpdateTaskInputSchema>,
    z.input<typeof ExtendedUpdateTaskInputSchema>
>(ExtendedUpdateTaskInputSchema);
export type ExtendedUpdateTaskInput = StructSelf<typeof ExtendedUpdateTaskInputStruct>;

export const TaskDependencySchema = z.object({
    taskId: z.string(),
    dependsOn: z.string(),
});
export const TaskDependencyStruct = struct.name("TaskDependency")<
    z.output<typeof TaskDependencySchema>,
    z.input<typeof TaskDependencySchema>
>(TaskDependencySchema);
export type TaskDependency = StructSelf<typeof TaskDependencyStruct>;

export const TaskAssignmentSchema = z.object({
    taskId: z.string(),
    assignedTo: z.string(),
    assignedBy: z.string(),
    assignedAt: z.date(),
});
export const TaskAssignmentStruct = struct.name("TaskAssignment")<
    z.output<typeof TaskAssignmentSchema>,
    z.input<typeof TaskAssignmentSchema>
>(TaskAssignmentSchema);
export type TaskAssignment = StructSelf<typeof TaskAssignmentStruct>;

export const TaskDomainRules = {
    validateTitle(title: string): Result<void> {
        if (!title || title.trim().length === 0) {
            return {
                success: false,
                error: new ValidationError("Title is required", "title"),
            };
        }
        if (title.length > 200) {
            return {
                success: false,
                error: new ValidationError("Title must be less than 200 characters", "title"),
            };
        }
        return { success: true, data: undefined };
    },

    validateDescription(description: string): Result<void> {
        if (!description || description.trim().length === 0) {
            return {
                success: false,
                error: new ValidationError("Description is required", "description"),
            };
        }
        if (description.length > 2000) {
            return {
                success: false,
                error: new ValidationError("Description must be less than 2000 characters", "description"),
            };
        }
        return { success: true, data: undefined };
    },

    validatePriority(priority: TaskPriority): Result<void> {
        const validPriorities: TaskPriority[] = ["low", "medium", "high"];
        if (!validPriorities.includes(priority)) {
            return {
                success: false,
                error: new ValidationError("Invalid priority", "priority"),
            };
        }
        return { success: true, data: undefined };
    },

    validateStatus(status: TaskStatus): Result<void> {
        const validStatuses: TaskStatus[] = ["todo", "in-progress", "done"];
        if (!validStatuses.includes(status)) {
            return {
                success: false,
                error: new ValidationError("Invalid status", "status"),
            };
        }
        return { success: true, data: undefined };
    },

    validateDependencies(dependencies: string[]): Result<void> {
        if (dependencies.some((dep) => !dep || dep.trim().length === 0)) {
            return {
                success: false,
                error: new ValidationError("Dependencies cannot be empty strings", "dependencies"),
            };
        }
        return { success: true, data: undefined };
    },

    validateCreateInput(input: CreateTaskInputWithPriority): Result<void> {
        const titleResult = TaskDomainRules.validateTitle(input.title);
        if (!titleResult.success) return titleResult;

        const descriptionResult = TaskDomainRules.validateDescription(input.description);
        if (!descriptionResult.success) return descriptionResult;

        const priorityResult = TaskDomainRules.validatePriority(input.priority || "medium");
        if (!priorityResult.success) return priorityResult;

        const dependenciesResult = TaskDomainRules.validateDependencies(input.dependencies || []);
        if (!dependenciesResult.success) return dependenciesResult;

        return { success: true, data: undefined };
    },

    validateUpdateInput(input: ExtendedUpdateTaskInput): Result<void> {
        if (input.title !== undefined) {
            const titleResult = TaskDomainRules.validateTitle(input.title);
            if (!titleResult.success) return titleResult;
        }

        if (input.description !== undefined) {
            const descriptionResult = TaskDomainRules.validateDescription(input.description);
            if (!descriptionResult.success) return descriptionResult;
        }

        if (input.status !== undefined) {
            const statusResult = TaskDomainRules.validateStatus(input.status);
            if (!statusResult.success) return statusResult;
        }

        return { success: true, data: undefined };
    },

    canTransitionStatus(from: TaskStatus, to: TaskStatus): boolean {
        const validTransitions: Record<TaskStatus, TaskStatus[]> = {
            todo: ["in-progress", "done"],
            "in-progress": ["done", "todo"],
            done: ["todo", "in-progress"],
        };
        return validTransitions[from].includes(to);
    },

    hasCircularDependency(_taskId: string, dependencies: string[], allTasks: TaskEntity[]): boolean {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const hasCycle = (currentId: string): boolean => {
            if (recursionStack.has(currentId)) {
                return true;
            }
            if (visited.has(currentId)) {
                return false;
            }

            visited.add(currentId);
            recursionStack.add(currentId);

            const currentTask = allTasks.find((task) => task.id === currentId);
            if (currentTask) {
                for (const depId of currentTask.dependencies) {
                    if (hasCycle(depId)) {
                        return true;
                    }
                }
            }

            recursionStack.delete(currentId);
            return false;
        };

        for (const depId of dependencies) {
            if (hasCycle(depId)) {
                return true;
            }
        }

        return false;
    },

    getPriorityWeight(priority: TaskPriority): number {
        switch (priority) {
            case "high":
                return 3;
            case "medium":
                return 2;
            case "low":
                return 1;
            default:
                return 0;
        }
    },

    sortTasksByPriorityAndDependencies(tasks: TaskEntity[]): TaskEntity[] {
        const sortedByPriority = [...tasks].sort(
            (a, b) =>
                TaskDomainRules.getPriorityWeight(b.priority) -
                TaskDomainRules.getPriorityWeight(a.priority),
        );

        return TaskDomainRules.topologicalSort(sortedByPriority);
    },

    topologicalSort(tasks: TaskEntity[]): TaskEntity[] {
        const result: TaskEntity[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();

        const visit = (task: TaskEntity): void => {
            if (visiting.has(task.id)) {
                return;
            }
            if (visited.has(task.id)) {
                return;
            }

            visiting.add(task.id);

            for (const depId of task.dependencies) {
                const depTask = tasks.find((candidate) => candidate.id === depId);
                if (depTask) {
                    visit(depTask);
                }
            }

            visiting.delete(task.id);
            visited.add(task.id);
            result.push(task);
        };

        for (const task of tasks) {
            visit(task);
        }

        return result;
    },
};

export const TaskFactory = {
    create(input: CreateTaskInputWithPriority, createdBy: string): Result<TaskEntity> {
        const validation = TaskDomainRules.validateCreateInput(input);
        if (!validation.success) {
            return { success: false, error: validation.error };
        }

        const now = new Date();
        const task: TaskEntity = {
            id: `task-${Date.now()}`,
            title: input.title,
            description: input.description,
            status: "todo",
            priority: input.priority || "medium",
            type: input.type || "task",
            dependencies: input.dependencies || [],
            createdBy,
            assignedTo: input.assignedTo,
            collaborators: input.collaborators,
            watchers: input.watchers,
            actionLog: [],
            createdAt: now,
            updatedAt: now,
        };

        return { success: true, data: task };
    },

    update(task: TaskEntity, input: ExtendedUpdateTaskInput): Result<TaskEntity> {
        const validation = TaskDomainRules.validateUpdateInput(input);
        if (!validation.success) {
            return { success: false, error: validation.error };
        }

        const updatedTask: TaskEntity = {
            ...task,
            ...input,
            updatedAt: new Date(),
        };

        if (
            input.status !== undefined &&
            input.status !== task.status &&
            !TaskDomainRules.canTransitionStatus(task.status, input.status)
        ) {
            return {
                success: false,
                error: new ValidationError(
                    `Invalid status transition: ${task.status} -> ${input.status}`,
                    "status",
                ),
            };
        }

        return { success: true, data: updatedTask };
    },
};
