import type { Task } from "./types.ts";

export type TaskNode = {
    id: string;
    task: Task;
    x: number;
    y: number;
    level: number;
    dependencies: string[];
    dependents: string[];
    isCritical: boolean;
    earliestStart: number;
    earliestFinish: number;
    latestStart: number;
    latestFinish: number;
    slack: number;
};

export type DependencyLink = {
    source: string;
    target: string;
    isCritical: boolean;
};

export type CriticalPathResult = {
    nodes: TaskNode[];
    links: DependencyLink[];
    criticalPath: string[];
    projectDuration: number;
    levels: number;
};

export type ImpactAnalysis = {
    taskId: string;
    delayDays: number;
    affectedTasks: string[];
    criticalPathImpact: boolean;
    newProjectDuration: number;
    delayedTasks: Array<{
        taskId: string;
        delayDays: number;
        newStartDate: Date;
        newEndDate: Date;
    }>;
};

const buildTaskLevels = (dependencyMap: Map<string, string[]>): Record<string, number> => {
    const levels: Record<string, number> = {};
    const visited = new Set<string>();

    const calculateLevel = (taskId: string): number => {
        if (visited.has(taskId)) {
            return levels[taskId] || 0;
        }

        visited.add(taskId);
        const dependencies = dependencyMap.get(taskId) || [];

        if (dependencies.length === 0) {
            levels[taskId] = 0;
            return 0;
        }

        const maxDepLevel = Math.max(...dependencies.map((depId) => calculateLevel(depId)));
        levels[taskId] = maxDepLevel + 1;
        return levels[taskId] + 1;
    };

    for (const taskId of dependencyMap.keys()) {
        calculateLevel(taskId);
    }

    return levels;
};

const buildInitialNodes = (tasks: Task[]): TaskNode[] => {
    const dependencyMap = new Map<string, string[]>();
    const dependentMap = new Map<string, string[]>();

    for (const task of tasks) {
        dependencyMap.set(task.id, task.dependencies || []);
        dependentMap.set(task.id, []);
    }

    for (const task of tasks) {
        for (const depId of task.dependencies || []) {
            if (dependentMap.has(depId)) {
                dependentMap.get(depId)?.push(task.id);
            }
        }
    }

    const levels = buildTaskLevels(dependencyMap);
    return tasks.map((task) => {
        const level = levels[task.id] || 0;
        const levelTasks = Object.entries(levels).filter((entry) => entry[1] === level);
        const indexInLevel = levelTasks.findIndex(([id]) => id === task.id);
        const tasksInLevel = levelTasks.length;

        const x = (indexInLevel + 1) * (800 / (tasksInLevel + 1));
        const y = level * 120 + 100;

        return {
            id: task.id,
            task,
            x,
            y,
            level,
            dependencies: dependencyMap.get(task.id) || [],
            dependents: dependentMap.get(task.id) || [],
            isCritical: false,
            earliestStart: 0,
            earliestFinish: 0,
            latestStart: 0,
            latestFinish: 0,
            slack: 0,
        };
    });
};

const estimateTaskDuration = (task: Task): number => {
    let baseDuration = 1;

    switch (task.type) {
        case "feature":
            baseDuration = 5;
            break;
        case "story":
            baseDuration = 3;
            break;
        case "implementation":
        case "task":
            baseDuration = 1;
            break;
        case "integration":
        case "testing":
            baseDuration = 2;
            break;
        case "research":
            baseDuration = 4;
            break;
        default:
            baseDuration = 1;
            break;
    }

    switch (task.priority) {
        case "high":
            baseDuration *= 0.8;
            break;
        case "low":
            baseDuration *= 1.5;
            break;
        default:
            break;
    }

    if (task.status === "done") {
        baseDuration = 0.1;
    } else if (task.status === "in-progress") {
        baseDuration *= 0.5;
    }

    return Math.max(0.1, baseDuration);
};

const forwardPass = (nodes: TaskNode[]): TaskNode[] => {
    const sortedNodes = [...nodes].sort((a, b) => a.level - b.level);
    const earliestFinishById = new Map<string, number>();

    const updatedNodes = sortedNodes.map((node) => {
        const earliestStart =
            node.dependencies.length === 0
                ? 0
                : Math.max(
                        ...node.dependencies.map((depId) => earliestFinishById.get(depId) || 0),
                    );

        const duration = estimateTaskDuration(node.task);
        const earliestFinish = earliestStart + duration;
        earliestFinishById.set(node.id, earliestFinish);

        return {
            ...node,
            earliestStart,
            earliestFinish,
        };
    });

    const updatedMap = new Map(updatedNodes.map((node) => [node.id, node]));
    return nodes.map((node) => updatedMap.get(node.id) || node);
};

const backwardPass = (nodes: TaskNode[]): TaskNode[] => {
    const sortedNodes = [...nodes].sort((a, b) => b.level - a.level);
    const projectDuration = Math.max(...nodes.map((n) => n.earliestFinish));
    const latestStartById = new Map<string, number>();

    const updatedNodes = sortedNodes.map((node) => {
        const latestFinish =
            node.dependents.length === 0
                ? projectDuration
                : Math.min(
                        ...node.dependents.map(
                            (depId) => latestStartById.get(depId) ?? projectDuration,
                        ),
                    );

        const duration = estimateTaskDuration(node.task);
        const latestStart = latestFinish - duration;
        latestStartById.set(node.id, latestStart);

        return {
            ...node,
            latestFinish,
            latestStart,
        };
    });

    const updatedMap = new Map(updatedNodes.map((node) => [node.id, node]));
    return nodes.map((node) => updatedMap.get(node.id) || node);
};

const applySlack = (nodes: TaskNode[]): TaskNode[] => {
    return nodes.map((node) => ({
        ...node,
        slack: node.latestStart - node.earliestStart,
    }));
};

const identifyCriticalPath = (nodes: TaskNode[]): string[] => {
    const criticalTasks = nodes.filter((node) => node.slack <= 0.1);

    if (criticalTasks.length === 0) {
        return [];
    }

    const startTasks = criticalTasks.filter(
        (task) =>
            task.dependencies.length === 0 ||
            !task.dependencies.some((depId) => criticalTasks.some((ct) => ct.id === depId)),
    );

    const endTasks = criticalTasks.filter(
        (task) =>
            task.dependents.length === 0 ||
            !task.dependents.some((depId) => criticalTasks.some((ct) => ct.id === depId)),
    );

    if (startTasks.length === 0 || endTasks.length === 0) {
        return criticalTasks.map((task) => task.id);
    }

    const nodeMap = new Map(criticalTasks.map((n) => [n.id, n]));
    let longestPath: string[] = [];
    let maxDuration = 0;

    const findPath = (taskId: string, currentPath: string[], currentDuration: number): void => {
        const node = nodeMap.get(taskId);
        if (!node) return;

        const nextPath = [...currentPath, taskId];
        const newDuration = currentDuration + estimateTaskDuration(node.task);

        if (endTasks.some((et) => et.id === taskId)) {
            if (newDuration > maxDuration) {
                maxDuration = newDuration;
                longestPath = nextPath;
            }
            return;
        }

        for (const depId of node.dependents) {
            if (nodeMap.has(depId)) {
                findPath(depId, nextPath, newDuration);
            }
        }
    };

    for (const startTask of startTasks) {
        findPath(startTask.id, [], 0);
    }

    return longestPath;
};

const calculateCriticalPath = (tasks: Task[]): CriticalPathResult => {
    const initialNodes = buildInitialNodes(tasks);
    const maxLevel = Math.max(...initialNodes.map((node) => node.level));

    const forwardNodes = forwardPass(initialNodes);
    const backwardNodes = backwardPass(forwardNodes);
    const withSlack = applySlack(backwardNodes);

    const criticalPath = identifyCriticalPath(withSlack);
    const criticalPathSet = new Set(criticalPath);

    const nodes = withSlack.map((node) => ({
        ...node,
        isCritical: criticalPathSet.has(node.id),
    }));

    const links = nodes.flatMap((node) =>
        node.dependencies.map((depId) => ({
            source: depId,
            target: node.id,
            isCritical: criticalPathSet.has(depId) && criticalPathSet.has(node.id),
        })),
    );

    return {
        nodes,
        links,
        criticalPath,
        projectDuration: Math.max(...nodes.map((n) => n.earliestFinish)),
        levels: maxLevel + 1,
    };
};

const analyzeDelayImpact = (tasks: Task[], taskId: string, delayDays: number): ImpactAnalysis => {
    const criticalPathResult = calculateCriticalPath(tasks);
    const nodeMap = new Map(criticalPathResult.nodes.map((n) => [n.id, n]));
    const targetNode = nodeMap.get(taskId);

    if (!targetNode) {
        throw new Error(`Task ${taskId} not found`);
    }

    const affectedTasks = new Set<string>();
    const findAffectedTasks = (currentTaskId: string): void => {
        const node = nodeMap.get(currentTaskId);
        if (!node) return;

        for (const dependentId of node.dependents) {
            if (!affectedTasks.has(dependentId)) {
                affectedTasks.add(dependentId);
                findAffectedTasks(dependentId);
            }
        }
    };

    findAffectedTasks(taskId);

    const criticalPathImpact =
        targetNode.isCritical ||
        Array.from(affectedTasks).some((taskKey) => nodeMap.get(taskKey)?.isCritical);

    const newProjectDuration = criticalPathImpact
        ? criticalPathResult.projectDuration + delayDays
        : criticalPathResult.projectDuration;

    const now = new Date();
    const delayedTasks = Array.from(affectedTasks)
        .map((affectedTaskId) => {
            const node = nodeMap.get(affectedTaskId);
            if (!node) return null;

            const taskDelay = criticalPathImpact ? delayDays : 0;
            const originalStart = new Date(
                now.getTime() + node.earliestStart * 24 * 60 * 60 * 1000,
            );
            const originalEnd = new Date(
                now.getTime() + node.earliestFinish * 24 * 60 * 60 * 1000,
            );

            return {
                taskId: affectedTaskId,
                delayDays: taskDelay,
                newStartDate: new Date(originalStart.getTime() + taskDelay * 24 * 60 * 60 * 1000),
                newEndDate: new Date(originalEnd.getTime() + taskDelay * 24 * 60 * 60 * 1000),
            };
        })
        .filter((entry): entry is ImpactAnalysis["delayedTasks"][number] => Boolean(entry));

    return {
        taskId,
        delayDays,
        affectedTasks: Array.from(affectedTasks),
        criticalPathImpact,
        newProjectDuration,
        delayedTasks,
    };
};

const getAvailableTasks = (tasks: Task[]): Task[] => {
    const taskMap = new Map(tasks.map((task) => [task.id, task]));

    return tasks.filter((task) => {
        if (task.status === "done") return false;

        return (task.dependencies || []).every((depId) => {
            const depTask = taskMap.get(depId);
            return depTask !== undefined && depTask.status === "done";
        });
    });
};

const getBlockingTasks = (tasks: Task[]): Task[] => {
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const blockingTasks = new Set<string>();

    for (const task of tasks) {
        if (task.status !== "done") {
            for (const depId of task.dependencies || []) {
                const depTask = taskMap.get(depId);
                if (depTask && depTask.status !== "done") {
                    blockingTasks.add(depId);
                }
            }
        }
    }

    return Array.from(blockingTasks)
        .map((id) => taskMap.get(id))
        .filter((task): task is Task => Boolean(task));
};

export const CriticalPathService = {
    calculateCriticalPath,
    analyzeDelayImpact,
    getAvailableTasks,
    getBlockingTasks,
};
