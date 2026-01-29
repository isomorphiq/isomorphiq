import { createConnection } from "node:net";
import { strict as assert } from "node:assert";

type Task = {
    id: string;
    title: string;
    description: string;
    status: "todo" | "in-progress" | "done";
    priority: "low" | "medium" | "high";
    type?: string;
    dependencies?: string[];
    createdBy?: string;
    createdAt: string;
    updatedAt: string;
    actionLog?: any[];
};

/**
 * TCP Client for daemon communication
 */
class DaemonTcpClient {
    private port: number;
    private host: string;

    constructor(port: number = 3001, host: string = "localhost") {
        this.port = port;
        this.host = host;
    }

    async sendCommand<T = unknown, R = unknown>(command: string, data: T): Promise<R> {
        return new Promise((resolve, reject) => {
            const client = createConnection({ port: this.port, host: this.host }, () => {
                console.log("[CASCADE-0] Connected to daemon");
                const message = `${JSON.stringify({ command, data })}\n`;
                client.write(message);
            });

            let response = "";
            client.on("data", (data) => {
                response += data.toString();
                try {
                    const result = JSON.parse(response.trim());
                    client.end();
                    resolve(result);
                } catch (_e) {
                    void _e;
                    // Wait for more data
                }
            });

            client.on("error", (err) => {
                console.error("[CASCADE-0] Daemon connection error:", err.message);
                reject(new Error("Failed to connect to daemon"));
            });

            client.on("close", () => {
                if (!response) {
                    reject(new Error("Connection closed without response"));
                }
            });

            // Timeout after 10 seconds for cascade operations
            setTimeout(() => {
                client.destroy();
                reject(new Error("Request timeout"));
            }, 10000);
        });
    }

    async createTask(taskData: Partial<Task>): Promise<{ success: boolean; data?: Task }> {
        return this.sendCommand("create_task", taskData);
    }

    async getTask(id: string): Promise<{ success: boolean; data?: Task }> {
        return this.sendCommand("get_task", { id });
    }

    async updateTask(id: string, updates: Partial<Task>): Promise<{ success: boolean; data?: Task }> {
        return this.sendCommand("update_task", { id, ...updates });
    }

    async updateTaskStatus(id: string, status: Task["status"]): Promise<{ success: boolean; data?: Task }> {
        return this.sendCommand("update_task_status", { id, status });
    }

    async updateTaskPriority(id: string, priority: Task["priority"]): Promise<{ success: boolean; data?: Task }> {
        return this.sendCommand("update_task_priority", { id, priority });
    }

    async listTasks(): Promise<{ success: boolean; data?: Task[] }> {
        return this.sendCommand("list_tasks", {});
    }

    disconnectWebSocket(): void {
        // No WebSocket in this implementation
        console.log("[CASCADE-0] TCP client disconnected");
    }
}

/**
 * Cascade Task 0 Implementation for Advanced CAS (b7c2d592)
 * 
 * This class implements the cascade dependency resolution mechanism
 * for task-b7c2d592-advanced-cas Cascade CAS Task 0.
 */
export class CascadeTask0 {
    private tcpClient: DaemonTcpClient;
    private taskId: string;
    private dependencies: string[] = [];
    private cascadeDepth: number = 0;

    constructor(tcpClient: DaemonTcpClient, taskId: string) {
        this.tcpClient = tcpClient;
        this.taskId = taskId;
    }

    /**
     * Initialize cascade task with dependencies
     */
    async initialize(dependencies: string[] = [], cascadeDepth: number = 3): Promise<void> {
        this.dependencies = dependencies;
        this.cascadeDepth = cascadeDepth;

        console.log(`[CASCADE-0] Initializing cascade task ${this.taskId} with ${dependencies.length} dependencies`);

        // Update task to reflect cascade initialization
        await this.tcpClient.updateTask(this.taskId, {
            description: `Cascade task 0 with ${dependencies.length} dependencies at depth ${cascadeDepth}`,
            dependencies: dependencies
        });
    }

    /**
     * Execute cascade dependency resolution
     */
    async executeCascade(): Promise<{ success: boolean; resolved: string[]; failed: string[] }> {
        console.log(`[CASCADE-0] Executing cascade resolution for task ${this.taskId}`);

        const resolved: string[] = [];
        const failed: string[] = [];

        // Mark main task as in-progress
        await this.tcpClient.updateTaskStatus(this.taskId, "in-progress");
        await this.tcpClient.updateTaskPriority(this.taskId, "high");

        try {
            // Phase 1: Resolve immediate dependencies
            for (const depId of this.dependencies) {
                try {
                    const result = await this.resolveDependency(depId, 0);
                    if (result.success) {
                        resolved.push(depId);
                    } else {
                        failed.push(depId);
                    }
                } catch (error) {
                    console.error(`[CASCADE-0] Failed to resolve dependency ${depId}:`, error);
                    failed.push(depId);
                }
            }

            // Phase 2: Handle cascading dependencies
            await this.handleCascadingDependencies(resolved, 1);

            // Phase 3: Finalize cascade execution
            await this.finalizeCascade(resolved, failed);

        } catch (error) {
            console.error(`[CASCADE-0] Cascade execution failed:`, error);
            failed.push(this.taskId);
        }

        return { success: failed.length === 0, resolved, failed };
    }

    /**
     * Resolve individual dependency with deadlock prevention
     */
    private async resolveDependency(depId: string, currentDepth: number): Promise<{ success: boolean; cascadedeps?: string[] }> {
        if (currentDepth >= this.cascadeDepth) {
            console.log(`[CASCADE-0] Maximum cascade depth reached for dependency ${depId}`);
            return { success: false };
        }

        console.log(`[CASCADE-0] Resolving dependency ${depId} at depth ${currentDepth}`);

        try {
            // Get dependency task details
            const depResult = await this.tcpClient.getTask(depId);
            if (!depResult.success || !depResult.data) {
                console.log(`[CASCADE-0] Dependency ${depId} not found`);
                return { success: false };
            }

            const depTask = depResult.data;

            // Check if dependency is already completed
            if (depTask.status === "done") {
                console.log(`[CASCADE-0] Dependency ${depId} already completed`);
                return { success: true };
            }

            // Set dependency to in-progress with high priority for deadlock prevention
            await this.tcpClient.updateTaskStatus(depId, "in-progress");
            await this.tcpClient.updateTaskPriority(depId, "high");

            // Simulate dependency resolution work
            await this.simulateDependencyWork(depId, currentDepth);

            // Check for cascading dependencies
            const cascadeDeps = await this.discoverCascadeDependencies(depId);
            if (cascadeDeps.length > 0) {
                console.log(`[CASCADE-0] Found ${cascadeDeps.length} cascading dependencies for ${depId}`);
                
                // Resolve cascading dependencies
                for (const cascadeDep of cascadeDeps) {
                    const cascadeResult = await this.resolveDependency(cascadeDep, currentDepth + 1);
                    if (!cascadeResult.success) {
                        console.log(`[CASCADE-0] Failed to resolve cascading dependency ${cascadeDep}`);
                        return { success: false, cascadedeps: cascadeDeps };
                    }
                }
            }

            // Complete the dependency
            await this.tcpClient.updateTaskStatus(depId, "done");
            await this.tcpClient.updateTaskPriority(depId, "medium");

            console.log(`[CASCADE-0] Successfully resolved dependency ${depId}`);
            return { success: true, cascadedeps: cascadeDeps };

        } catch (error) {
            console.error(`[CASCADE-0] Error resolving dependency ${depId}:`, error);
            
            // Attempt recovery
            try {
                await this.tcpClient.updateTaskStatus(depId, "todo");
                await this.tcpClient.updateTaskPriority(depId, "low");
            } catch (recoveryError) {
                console.error(`[CASCADE-0] Recovery failed for dependency ${depId}:`, recoveryError);
            }
            
            return { success: false };
        }
    }

    /**
     * Simulate dependency work with realistic timing
     */
    private async simulateDependencyWork(depId: string, depth: number): Promise<void> {
        const workTime = 100 + (depth * 50) + Math.random() * 100;
        await new Promise(resolve => setTimeout(resolve, workTime));

        // Update task description to reflect work progress
        try {
            const currentResult = await this.tcpClient.getTask(depId);
            if (currentResult.success && currentResult.data) {
                await this.tcpClient.updateTask(depId, {
                    description: `Processing dependency work at depth ${depth} (${workTime.toFixed(0)}ms)`
                });
            }
        } catch (error) {
            // Ignore update errors during simulation
        }
    }

    /**
     * Discover cascading dependencies based on task patterns
     */
    private async discoverCascadeDependencies(taskId: string): Promise<string[]> {
        const cascadeDeps: string[] = [];

        try {
            // Get all tasks to find potential cascade dependencies
            const allTasksResult = await this.tcpClient.listTasks();
            if (!allTasksResult.success || !allTasksResult.data) {
                return cascadeDeps;
            }

            const allTasks = allTasksResult.data;
            const currentTask = allTasks.find((t: Task) => t.id === taskId);

            if (!currentTask) {
                return cascadeDeps;
            }

            // Find tasks that might be cascade dependencies based on:
            // 1. Title patterns
            // 2. Description references
            // 3. Creator patterns
            // 4. Priority relationships

            for (const task of allTasks) {
                if (task.id === taskId) continue;

                // Check for cascade dependency patterns
                if (this.isCascadeDependency(currentTask, task)) {
                    cascadeDeps.push(task.id);
                }
            }

        } catch (error) {
            console.error(`[CASCADE-0] Error discovering cascade dependencies for ${taskId}:`, error);
        }

        return cascadeDeps;
    }

    /**
     * Determine if one task is a cascade dependency of another
     */
    private isCascadeDependency(parent: Task, candidate: Task): boolean {
        // Pattern 1: Same creator with sequential numbering
        if (parent.createdBy === candidate.createdBy) {
            const parentMatch = parent.title.match(/(\d+)$/);
            const candidateMatch = candidate.title.match(/(\d+)$/);
            
            if (parentMatch && candidateMatch) {
                const parentNum = parseInt(parentMatch[1]);
                const candidateNum = parseInt(candidateMatch[1]);
                
                // Candidate is sequentially after parent
                if (candidateNum === parentNum + 1) {
                    return true;
                }
            }
        }

        // Pattern 2: Same task family with "cascade" or "dependency" keywords
        const parentBase = parent.title.replace(/\s*\d+$/, '').toLowerCase();
        const candidateBase = candidate.title.replace(/\s*\d+$/, '').toLowerCase();

        if (parentBase.includes('cascade') && candidateBase.includes('cascade')) {
            return true;
        }

        // Pattern 3: Same test family with different roles
        if (parent.createdBy?.includes('deadlock') && candidate.createdBy?.includes('deadlock')) {
            return parent.title !== candidate.title;
        }

        return false;
    }

    /**
     * Handle cascading dependencies with deadlock prevention
     */
    private async handleCascadingDependencies(resolved: string[], currentDepth: number): Promise<void> {
        if (currentDepth >= this.cascadeDepth) {
            console.log(`[CASCADE-0] Maximum cascade depth reached in cascading phase`);
            return;
        }

        console.log(`[CASCADE-0] Handling cascading dependencies at depth ${currentDepth}`);

        // Process resolved dependencies to find their cascading dependencies
        for (const depId of resolved) {
            try {
                const cascadeDeps = await this.discoverCascadeDependencies(depId);
                
                for (const cascadeDep of cascadeDeps) {
                    // Check if already processed
                    if (resolved.includes(cascadeDep)) {
                        continue;
                    }

                    // Resolve cascading dependency with timeout for deadlock prevention
                    const timeoutMs = 5000 + (currentDepth * 1000);
                    const cascadePromise = this.resolveDependency(cascadeDep, currentDepth + 1);
                    const timeoutPromise = new Promise<{ success: false }>((_, reject) => {
                        setTimeout(() => reject(new Error("Cascade dependency timeout")), timeoutMs);
                    });

                    try {
                        const result = await Promise.race([cascadePromise, timeoutPromise]);
                        if (result.success) {
                            resolved.push(cascadeDep);
                        }
                    } catch (error) {
                        console.log(`[CASCADE-0] Cascading dependency ${cascadeDep} timed out at depth ${currentDepth}`);
                        
                        // Mark as failed but continue
                        try {
                            await this.tcpClient.updateTaskStatus(cascadeDep, "todo");
                            await this.tcpClient.updateTaskPriority(cascadeDep, "low");
                        } catch (recoveryError) {
                            // Ignore recovery errors
                        }
                    }
                }
            } catch (error) {
                console.error(`[CASCADE-0] Error handling cascading dependencies for ${depId}:`, error);
            }
        }
    }

    /**
     * Finalize cascade execution
     */
    private async finalizeCascade(resolved: string[], failed: string[]): Promise<void> {
        console.log(`[CASCADE-0] Finalizing cascade: ${resolved.length} resolved, ${failed.length} failed`);

        try {
            // Update main task status based on results
            if (failed.length === 0) {
                await this.tcpClient.updateTaskStatus(this.taskId, "done");
                await this.tcpClient.updateTaskPriority(this.taskId, "medium");
                
                // Update task description with success details
                await this.tcpClient.updateTask(this.taskId, {
                    description: `Cascade completed successfully: ${resolved.length} dependencies resolved`
                });
                
                console.log(`[CASCADE-0] Cascade completed successfully for task ${this.taskId}`);
            } else {
                await this.tcpClient.updateTaskStatus(this.taskId, "todo");
                await this.tcpClient.updateTaskPriority(this.taskId, "low");
                
                // Update task description with failure details
                await this.tcpClient.updateTask(this.taskId, {
                    description: `Cascade partially completed: ${resolved.length} resolved, ${failed.length} failed`
                });
                
                console.log(`[CASCADE-0] Cascade partially completed for task ${this.taskId}`);
            }

        } catch (error) {
            console.error(`[CASCADE-0] Error finalizing cascade:`, error);
        }
    }

    /**
     * Get cascade status and metrics
     */
    async getStatus(): Promise<{
        taskId: string;
        dependencies: string[];
        cascadeDepth: number;
        resolved: number;
        failed: number;
    }> {
        try {
            const taskResult = await this.tcpClient.getTask(this.taskId);
            if (!taskResult.success || !taskResult.data) {
                throw new Error(`Task ${this.taskId} not found`);
            }

            const task = taskResult.data;
            
            // Count resolved and failed dependencies
            let resolved = 0;
            let failed = 0;

            for (const depId of this.dependencies) {
                const depResult = await this.tcpClient.getTask(depId);
                if (depResult.success && depResult.data) {
                    if (depResult.data.status === "done") {
                        resolved++;
                    } else if (depResult.data.status === "todo" && depResult.data.priority === "low") {
                        failed++;
                    }
                } else {
                    failed++;
                }
            }

            return {
                taskId: this.taskId,
                dependencies: this.dependencies,
                cascadeDepth: this.cascadeDepth,
                resolved,
                failed
            };

        } catch (error) {
            console.error(`[CASCADE-0] Error getting status:`, error);
            return {
                taskId: this.taskId,
                dependencies: this.dependencies,
                cascadeDepth: this.cascadeDepth,
                resolved: 0,
                failed: this.dependencies.length
            };
        }
    }
}

/**
 * Factory function to create and execute a cascade task
 */
export async function createAndExecuteCascadeTask0(
    tcpClient: DaemonTcpClient,
    title: string,
    description: string,
    dependencies: string[] = [],
    cascadeDepth: number = 3
): Promise<{ success: boolean; taskId: string; resolved: string[]; failed: string[] }> {
    try {
        // Create the main cascade task
        const taskResult = await tcpClient.createTask({
            title,
            description,
            priority: "high",
            dependencies: dependencies
        });

        if (!taskResult.success || !taskResult.data) {
            throw new Error("Failed to create cascade task");
        }

        const taskId = taskResult.data.id;
        console.log(`[CASCADE-0] Created cascade task: ${taskId}`);

        // Initialize cascade task
        const cascadeTask = new CascadeTask0(tcpClient, taskId);
        await cascadeTask.initialize(dependencies, cascadeDepth);

        // Execute cascade
        const result = await cascadeTask.executeCascade();

        return {
            success: result.success,
            taskId,
            resolved: result.resolved,
            failed: result.failed
        };

    } catch (error) {
        console.error("[CASCADE-0] Error in createAndExecuteCascadeTask0:", error);
        return {
            success: false,
            taskId: "",
            resolved: [],
            failed: dependencies
        };
    }
}