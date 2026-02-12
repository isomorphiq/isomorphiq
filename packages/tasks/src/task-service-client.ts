import type { Result } from "@isomorphiq/core";
import type {
    CreateTaskInputWithPriority,
    ExtendedUpdateTaskInput,
    TaskEntity,
} from "./task-domain.ts";
import type { TaskPriority, TaskSearchOptions, TaskStatus } from "./types.ts";
import type { TaskServiceApi } from "./task-service.ts";
import type { TaskClient } from "./task-client.ts";

const wrapResult = async <T>(action: () => Promise<T>): Promise<Result<T>> => {
    try {
        const data = await action();
        return { success: true, data };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
};

export const createTaskServiceClient = (client: TaskClient): TaskServiceApi => ({
    createTask: async (input: CreateTaskInputWithPriority, createdBy: string): Promise<Result<TaskEntity>> =>
        wrapResult(() => client.createTask(input, createdBy)),
    getTask: async (id: string): Promise<Result<TaskEntity>> =>
        wrapResult(async () => {
            const task = await client.getTask(id);
            if (!task) {
                throw new Error(`Task with id ${id} not found`);
            }
            return task;
        }),
    getTaskByBranch: async (branch: string): Promise<Result<TaskEntity | null>> =>
        wrapResult(() => client.getTaskByBranch(branch)),
    getAllTasks: async (): Promise<Result<TaskEntity[]>> => wrapResult(() => client.listTasks()),
    updateTask: async (
        id: string,
        input: ExtendedUpdateTaskInput,
        updatedBy: string,
    ): Promise<Result<TaskEntity>> =>
        wrapResult(() => client.updateTask(id, input, updatedBy)),
    deleteTask: async (id: string, deletedBy: string): Promise<Result<void>> =>
        wrapResult(async () => {
            await client.deleteTask(id, deletedBy);
            return undefined;
        }),
    getTasksByStatus: async (status: TaskStatus): Promise<Result<TaskEntity[]>> =>
        wrapResult(() => client.getTasksByStatus(status)),
    getTasksByUser: async (userId: string): Promise<Result<TaskEntity[]>> =>
        wrapResult(() => client.getTasksByUser(userId)),
    searchTasks: async (
        options: TaskSearchOptions,
    ): Promise<Result<{ tasks: TaskEntity[]; total: number }>> =>
        wrapResult(() => client.searchTasks(options)),
    assignTask: async (taskId: string, assignedTo: string, assignedBy: string): Promise<Result<TaskEntity>> =>
        wrapResult(() => client.assignTask(taskId, assignedTo, assignedBy)),
    updateTaskStatus: async (
        taskId: string,
        status: TaskStatus,
        updatedBy: string,
    ): Promise<Result<TaskEntity>> =>
        wrapResult(() => client.updateTaskStatus(taskId, status, updatedBy)),
    updateTaskPriority: async (
        taskId: string,
        priority: TaskPriority,
        updatedBy: string,
    ): Promise<Result<TaskEntity>> =>
        wrapResult(() => client.updateTaskPriority(taskId, priority, updatedBy)),
    addCollaborator: async (
        taskId: string,
        userId: string,
        updatedBy: string,
    ): Promise<Result<TaskEntity>> =>
        wrapResult(() => client.addCollaborator(taskId, userId, updatedBy)),
    removeCollaborator: async (
        taskId: string,
        userId: string,
        updatedBy: string,
    ): Promise<Result<TaskEntity>> =>
        wrapResult(() => client.removeCollaborator(taskId, userId, updatedBy)),
    addWatcher: async (taskId: string, userId: string, updatedBy: string): Promise<Result<TaskEntity>> =>
        wrapResult(() => client.addWatcher(taskId, userId, updatedBy)),
    removeWatcher: async (taskId: string, userId: string, updatedBy: string): Promise<Result<TaskEntity>> =>
        wrapResult(() => client.removeWatcher(taskId, userId, updatedBy)),
    addDependency: async (
        taskId: string,
        dependsOn: string,
        updatedBy: string,
    ): Promise<Result<TaskEntity>> =>
        wrapResult(() => client.addDependency(taskId, dependsOn, updatedBy)),
    removeDependency: async (
        taskId: string,
        dependsOn: string,
        updatedBy: string,
    ): Promise<Result<TaskEntity>> =>
        wrapResult(() => client.removeDependency(taskId, dependsOn, updatedBy)),
    getTasksSortedByDependencies: async (): Promise<Result<TaskEntity[]>> =>
        wrapResult(() => client.getTasksSortedByDependencies()),
    createManyTasks: async (
        inputs: CreateTaskInputWithPriority[],
        createdBy: string,
    ): Promise<Result<TaskEntity[]>> =>
        wrapResult(() => client.createManyTasks(inputs, createdBy)),
});
