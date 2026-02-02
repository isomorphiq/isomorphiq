import type { Result } from "@isomorphiq/core";
import { ValidationError } from "@isomorphiq/core";
import type { WorkflowExecution, WorkflowNodeExecution } from "./types.ts";

export interface DependencySatisfactionCheckerConfig {
    validateBeforeTransition: boolean;
    allowPartialSatisfaction: boolean;
    blockOnUnsatisfiedDependencies: boolean;
}

export const defaultDependencySatisfactionCheckerConfig: DependencySatisfactionCheckerConfig = {
    validateBeforeTransition: true,
    allowPartialSatisfaction: false,
    blockOnUnsatisfiedDependencies: true,
};

export interface DependencyStatus {
    dependencyId: string;
    satisfied: boolean;
    satisfiedAt?: Date;
    blockedReason?: string;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class DependencySatisfactionChecker {
    private config: DependencySatisfactionCheckerConfig;
    private dependencyCache: Map<string, DependencyStatus[]> = new Map();

    constructor(config: Partial<DependencySatisfactionCheckerConfig> = {}) {
        this.config = { ...defaultDependencySatisfactionCheckerConfig, ...config };
    }

    async validateDependenciesBeforeTransition(
        storyId: string,
        dependencies: string[],
        targetState: string,
    ): Promise<Result<{ canTransition: boolean; unsatisfiedDependencies: string[] }>> {
        if (!this.config.validateBeforeTransition) {
            return { success: true, data: { canTransition: true, unsatisfiedDependencies: [] } };
        }

        const dependencyStatuses = await this.checkDependencyStatuses(storyId, dependencies);
        const unsatisfiedDependencies = dependencyStatuses
            .filter((d) => !d.satisfied)
            .map((d) => d.dependencyId);

        const canTransition = this.config.allowPartialSatisfaction
            ? unsatisfiedDependencies.length === 0 || unsatisfiedDependencies.length < dependencies.length
            : unsatisfiedDependencies.length === 0;

        if (!canTransition && this.config.blockOnUnsatisfiedDependencies) {
            return {
                success: false,
                error: new ValidationError(
                    `Cannot transition to ${targetState}. Unsatisfied dependencies: ${unsatisfiedDependencies.join(", ")}`,
                    "dependencies",
                ),
            };
        }

        return { success: true, data: { canTransition, unsatisfiedDependencies } };
    }

    private async checkDependencyStatuses(storyId: string, dependencies: string[]): Promise<DependencyStatus[]> {
        const cached = this.dependencyCache.get(storyId);
        if (cached) {
            return cached;
        }

        const statuses: DependencyStatus[] = dependencies.map((depId) => ({
            dependencyId: depId,
            satisfied: false,
            blockedReason: "Pending verification",
        }));

        this.dependencyCache.set(storyId, statuses);
        return statuses;
    }

    markDependencySatisfied(storyId: string, dependencyId: string): void {
        const statuses = this.dependencyCache.get(storyId) || [];
        const depStatus = statuses.find((d) => d.dependencyId === dependencyId);

        if (depStatus) {
            depStatus.satisfied = true;
            depStatus.satisfiedAt = new Date();
            depStatus.blockedReason = undefined;
        } else {
            statuses.push({
                dependencyId,
                satisfied: true,
                satisfiedAt: new Date(),
            });
        }

        this.dependencyCache.set(storyId, statuses);
    }

    markDependencyBlocked(storyId: string, dependencyId: string, reason: string): void {
        const statuses = this.dependencyCache.get(storyId) || [];
        const depStatus = statuses.find((d) => d.dependencyId === dependencyId);

        if (depStatus) {
            depStatus.satisfied = false;
            depStatus.blockedReason = reason;
        } else {
            statuses.push({
                dependencyId,
                satisfied: false,
                blockedReason: reason,
            });
        }

        this.dependencyCache.set(storyId, statuses);
    }

    clearCache(storyId?: string): void {
        if (storyId) {
            this.dependencyCache.delete(storyId);
        } else {
            this.dependencyCache.clear();
        }
    }

    getCachedDependencies(storyId: string): DependencyStatus[] {
        return this.dependencyCache.get(storyId) || [];
    }
}

export interface CriticalPathIntegrationConfig {
    highlightCriticalPathStories: boolean;
    prioritizeCriticalPathStories: boolean;
    criticalPathBoostFactor: number;
}

export const defaultCriticalPathIntegrationConfig: CriticalPathIntegrationConfig = {
    highlightCriticalPathStories: true,
    prioritizeCriticalPathStories: true,
    criticalPathBoostFactor: 1.2,
};

export interface CriticalPathNode {
    storyId: string;
    estimatedDuration: number;
    dependencies: string[];
    isOnCriticalPath: boolean;
    slack: number;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class CriticalPathIntegration {
    private config: CriticalPathIntegrationConfig;
    private criticalPathCache: Map<string, CriticalPathNode[]> = new Map();

    constructor(config: Partial<CriticalPathIntegrationConfig> = {}) {
        this.config = { ...defaultCriticalPathIntegrationConfig, ...config };
    }

    async calculateCriticalPath(stories: Array<{
        id: string;
        estimatedDuration: number;
        dependencies: string[];
    }>): Promise<Result<CriticalPathNode[]>> {
        const nodes: CriticalPathNode[] = stories.map((story) => ({
            storyId: story.id,
            estimatedDuration: story.estimatedDuration,
            dependencies: story.dependencies,
            isOnCriticalPath: false,
            slack: 0,
        }));

        const criticalPath = this.identifyCriticalPath(nodes);

        for (const node of criticalPath) {
            node.isOnCriticalPath = true;
        }

        this.criticalPathCache.set("current", nodes);
        return { success: true, data: nodes };
    }

    private identifyCriticalPath(nodes: CriticalPathNode[]): CriticalPathNode[] {
        if (nodes.length === 0) {
            return [];
        }

        const nodeMap = new Map(nodes.map((n) => [n.storyId, n]));
        const visited = new Set<string>();
        const path: CriticalPathNode[] = [];

        const visit = (nodeId: string, currentPath: CriticalPathNode[]): void => {
            if (visited.has(nodeId)) {
                return;
            }

            const node = nodeMap.get(nodeId);
            if (!node) {
                return;
            }

            visited.add(nodeId);
            currentPath.push(node);

            for (const depId of node.dependencies) {
                visit(depId, currentPath);
            }
        };

        for (const node of nodes) {
            if (!visited.has(node.storyId)) {
                const currentPath: CriticalPathNode[] = [];
                visit(node.storyId, currentPath);
                if (currentPath.length > path.length) {
                    path.length = 0;
                    path.push(...currentPath);
                }
            }
        }

        return path;
    }

    isStoryOnCriticalPath(storyId: string): boolean {
        const nodes = this.criticalPathCache.get("current") || [];
        const node = nodes.find((n) => n.storyId === storyId);
        return node?.isOnCriticalPath || false;
    }

    getCriticalPathStories(): string[] {
        const nodes = this.criticalPathCache.get("current") || [];
        return nodes.filter((n) => n.isOnCriticalPath).map((n) => n.storyId);
    }

    applyCriticalPathBoost(basePriority: number, storyId: string): number {
        if (!this.config.prioritizeCriticalPathStories) {
            return basePriority;
        }

        if (this.isStoryOnCriticalPath(storyId)) {
            return basePriority * this.config.criticalPathBoostFactor;
        }

        return basePriority;
    }

    clearCache(): void {
        this.criticalPathCache.clear();
    }
}

export interface DependencyBlockingWorkflowConfig {
    autoBlockOnDependencyFailure: boolean;
    notifyOnBlock: boolean;
    allowManualOverride: boolean;
}

export const defaultDependencyBlockingWorkflowConfig: DependencyBlockingWorkflowConfig = {
    autoBlockOnDependencyFailure: true,
    notifyOnBlock: true,
    allowManualOverride: true,
};

export interface BlockedStory {
    storyId: string;
    blockedBy: string[];
    blockedAt: Date;
    reason: string;
    canBeManuallyUnblocked: boolean;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class DependencyBlockingWorkflow {
    private config: DependencyBlockingWorkflowConfig;
    private blockedStories: Map<string, BlockedStory> = new Map();

    constructor(config: Partial<DependencyBlockingWorkflowConfig> = {}) {
        this.config = { ...defaultDependencyBlockingWorkflowConfig, ...config };
    }

    async blockStory(
        storyId: string,
        blockedBy: string[],
        reason: string,
    ): Promise<Result<BlockedStory>> {
        const blockedStory: BlockedStory = {
            storyId,
            blockedBy,
            blockedAt: new Date(),
            reason,
            canBeManuallyUnblocked: this.config.allowManualOverride,
        };

        this.blockedStories.set(storyId, blockedStory);

        if (this.config.notifyOnBlock) {
            await this.notifyBlock(storyId, blockedBy, reason);
        }

        return { success: true, data: blockedStory };
    }

    async unblockStory(storyId: string, unblockedBy: string): Promise<Result<BlockedStory>> {
        const blockedStory = this.blockedStories.get(storyId);
        if (!blockedStory) {
            return {
                success: false,
                error: new ValidationError(`Story ${storyId} is not blocked`, "storyId"),
            };
        }

        this.blockedStories.delete(storyId);

        console.log(`Story ${storyId} unblocked by ${unblockedBy}`);

        return { success: true, data: blockedStory };
    }

    private async notifyBlock(storyId: string, blockedBy: string[], reason: string): Promise<void> {
        console.log(`Story ${storyId} blocked by ${blockedBy.join(", ")}. Reason: ${reason}`);
    }

    isStoryBlocked(storyId: string): boolean {
        return this.blockedStories.has(storyId);
    }

    getBlockedStory(storyId: string): BlockedStory | undefined {
        return this.blockedStories.get(storyId);
    }

    getAllBlockedStories(): BlockedStory[] {
        return Array.from(this.blockedStories.values());
    }

    getStoriesBlockedBy(dependencyId: string): string[] {
        return Array.from(this.blockedStories.values())
            .filter((s) => s.blockedBy.includes(dependencyId))
            .map((s) => s.storyId);
    }

    async checkAndBlockOnDependencyFailure(
        storyId: string,
        failedDependencies: string[],
    ): Promise<Result<boolean>> {
        if (!this.config.autoBlockOnDependencyFailure || failedDependencies.length === 0) {
            return { success: true, data: false };
        }

        const result = await this.blockStory(
            storyId,
            failedDependencies,
            `Dependencies failed: ${failedDependencies.join(", ")}`,
        );

        return { success: result.success, data: result.success };
    }
}

export interface CircularDependencyPreventionConfig {
    maxDependencyDepth: number;
    detectCycles: boolean;
    preventCycles: boolean;
}

export const defaultCircularDependencyPreventionConfig: CircularDependencyPreventionConfig = {
    maxDependencyDepth: 10,
    detectCycles: true,
    preventCycles: true,
};

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class CircularDependencyPrevention {
    private config: CircularDependencyPreventionConfig;

    constructor(config: Partial<CircularDependencyPreventionConfig> = {}) {
        this.config = { ...defaultCircularDependencyPreventionConfig, ...config };
    }

    detectCircularDependencies(
        storyId: string,
        dependencies: string[],
        allStories: Array<{ id: string; dependencies: string[] }>,
    ): Result<{ hasCycle: boolean; cycle: string[] }> {
        if (!this.config.detectCycles) {
            return { success: true, data: { hasCycle: false, cycle: [] } };
        }

        const storyMap = new Map(allStories.map((s) => [s.id, s]));
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const cycle: string[] = [];

        const hasCycle = (currentId: string, path: string[]): boolean => {
            if (recursionStack.has(currentId)) {
                const cycleStart = path.indexOf(currentId);
                cycle.push(...path.slice(cycleStart), currentId);
                return true;
            }

            if (visited.has(currentId)) {
                return false;
            }

            visited.add(currentId);
            recursionStack.add(currentId);
            path.push(currentId);

            const story = storyMap.get(currentId);
            if (story) {
                for (const depId of story.dependencies) {
                    if (hasCycle(depId, path)) {
                        return true;
                    }
                }
            }

            path.pop();
            recursionStack.delete(currentId);
            return false;
        };

        const foundCycle = hasCycle(storyId, []);

        return { success: true, data: { hasCycle: foundCycle, cycle } };
    }

    validateDependencyAddition(
        storyId: string,
        newDependencyId: string,
        allStories: Array<{ id: string; dependencies: string[] }>,
    ): Result<{ canAdd: boolean; reason?: string }> {
        if (!this.config.preventCycles) {
            return { success: true, data: { canAdd: true } };
        }

        const tempStories = [...allStories];
        const storyIndex = tempStories.findIndex((s) => s.id === storyId);

        if (storyIndex >= 0) {
            tempStories[storyIndex] = {
                ...tempStories[storyIndex],
                dependencies: [...tempStories[storyIndex].dependencies, newDependencyId],
            };
        }

        const cycleCheck = this.detectCircularDependencies(storyId, tempStories[storyIndex]?.dependencies || [], tempStories);

        if (!cycleCheck.success) {
            return {
                success: false,
                error: cycleCheck.error,
            };
        }

        if (cycleCheck.data.hasCycle) {
            return {
                success: false,
                error: new ValidationError(
                    `Adding dependency ${newDependencyId} would create a cycle: ${cycleCheck.data.cycle.join(" -> ")}`,
                    "dependencies",
                ),
            };
        }

        const depthCheck = this.checkDependencyDepth(storyId, tempStories);
        if (!depthCheck.success) {
            return depthCheck;
        }

        return { success: true, data: { canAdd: true } };
    }

    private checkDependencyDepth(
        storyId: string,
        allStories: Array<{ id: string; dependencies: string[] }>,
    ): Result<{ canAdd: boolean; reason?: string }> {
        const storyMap = new Map(allStories.map((s) => [s.id, s]));

        const getDepth = (id: string, visited: Set<string> = new Set()): number => {
            if (visited.has(id)) {
                return 0;
            }

            visited.add(id);
            const story = storyMap.get(id);

            if (!story || story.dependencies.length === 0) {
                return 0;
            }

            const maxDepDepth = Math.max(...story.dependencies.map((depId) => getDepth(depId, new Set(visited))));
            return 1 + maxDepDepth;
        };

        const depth = getDepth(storyId);

        if (depth > this.config.maxDependencyDepth) {
            return {
                success: false,
                error: new ValidationError(
                    `Dependency depth (${depth}) exceeds maximum allowed (${this.config.maxDependencyDepth})`,
                    "dependencies",
                ),
            };
        }

        return { success: true, data: { canAdd: true } };
    }
}

export function createStoryDependencyWorkflowIntegration(
    satisfactionConfig?: Partial<DependencySatisfactionCheckerConfig>,
    criticalPathConfig?: Partial<CriticalPathIntegrationConfig>,
    blockingConfig?: Partial<DependencyBlockingWorkflowConfig>,
    cycleConfig?: Partial<CircularDependencyPreventionConfig>,
): {
    satisfactionChecker: DependencySatisfactionChecker;
    criticalPathIntegration: CriticalPathIntegration;
    blockingWorkflow: DependencyBlockingWorkflow;
    cyclePrevention: CircularDependencyPrevention;
} {
    return {
        satisfactionChecker: new DependencySatisfactionChecker(satisfactionConfig),
        criticalPathIntegration: new CriticalPathIntegration(criticalPathConfig),
        blockingWorkflow: new DependencyBlockingWorkflow(blockingConfig),
        cyclePrevention: new CircularDependencyPrevention(cycleConfig),
    };
}

