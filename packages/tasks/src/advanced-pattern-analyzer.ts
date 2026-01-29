import { randomUUID } from "node:crypto";
import type { Task, TaskStatus, TaskPriority } from "@isomorphiq/types";
import type { TaskPattern, RecommendationContext } from "@isomorphiq/core";
import type { PatternAnalyzer } from "./task-recommendation-service.ts";

interface TaskFeatureVector {
    taskId: string;
    features: {
        // Text features
        titleLength: number;
        descriptionLength: number;
        wordCount: number;
        keywordFrequency: Record<string, number>;
        
        // Temporal features
        creationHour: number;
        creationDayOfWeek: number;
        completionTime?: number; // in minutes
        ageInHours: number;
        
        // Structural features
        dependencyCount: number;
        collaboratorCount: number;
        watcherCount: number;
        
        // Priority features
        priorityScore: number; // high=3, medium=2, low=1
        
        // Status features
        isCompleted: boolean;
        statusChanges: number;
        
        // Assignment features
        isAssigned: boolean;
        assigneeWorkload?: number;
    };
}

interface Cluster {
    id: string;
    centroid: TaskFeatureVector["features"];
    tasks: string[];
    label: string;
    confidence: number;
}

interface SequencePattern {
    id: string;
    sequence: string[]; // task IDs
    frequency: number;
    confidence: number;
    context: string;
    avgCompletionTime: number;
    successRate: number;
}

interface DependencyPattern {
    id: string;
    fromTask: string;
    toTask: string;
    frequency: number;
    confidence: number;
    type: "sequential" | "parallel" | "blocking";
    avgDelay: number;
}

export class AdvancedPatternAnalyzer implements PatternAnalyzer {
    private taskCache: Map<string, Task> = new Map();
    private featureCache: Map<string, TaskFeatureVector> = new Map();
    private clusters: Cluster[] = [];
    private sequences: SequencePattern[] = [];
    private dependencies: DependencyPattern[] = [];
    private lastAnalysisTime = 0;
    private readonly analysisInterval = 60 * 60 * 1000; // 1 hour

    async analyzePatterns(tasks: Task[]): Promise<TaskPattern[]> {
        const now = Date.now();
        if (now - this.lastAnalysisTime < this.analysisInterval && this.clusters.length > 0) {
            return this.convertToTaskPatterns();
        }

        console.log("[PATTERN-ANALYSIS] Starting advanced pattern analysis");
        
        this.taskCache.clear();
        tasks.forEach(task => this.taskCache.set(task.id, task));
        
        // Extract features
        const features = await this.extractFeatures(tasks);
        this.featureCache.clear();
        features.forEach(fv => this.featureCache.set(fv.taskId, fv));
        
        // Perform clustering
        this.clusters = await this.performClustering(features);
        
        // Find sequential patterns
        this.sequences = await this.findSequentialPatterns(tasks);
        
        // Analyze dependency patterns
        this.dependencies = await this.analyzeDependencyPatterns(tasks);
        
        this.lastAnalysisTime = now;
        
        console.log(`[PATTERN-ANALYSIS] Found ${this.clusters.length} clusters, ${this.sequences.length} sequences, ${this.dependencies.length} dependency patterns`);
        
        return this.convertToTaskPatterns();
    }

    async updatePattern(pattern: TaskPattern): Promise<void> {
        // Update stored patterns with new data
        console.log(`[PATTERN-ANALYSIS] Updating pattern: ${pattern.id}`);
        
        // Re-analyze on next request
        this.lastAnalysisTime = 0;
    }

    async getPatternsForContext(context: RecommendationContext): Promise<TaskPattern[]> {
        const allPatterns = await this.analyzePatterns(Array.from(this.taskCache.values()));
        
        // Filter patterns relevant to context
        return allPatterns.filter(pattern => {
            if (context.taskId && pattern.tasks.includes(context.taskId)) {
                return true;
            }
            
            if (context.userId && this.isPatternRelevantToUser(pattern, context.userId)) {
                return true;
            }
            
            if (context.taskTitle) {
                return this.isPatternRelevantToText(pattern, context.taskTitle);
            }
            
            return pattern.isActive && pattern.confidence > 0.5;
        });
    }

    private async extractFeatures(tasks: Task[]): Promise<TaskFeatureVector[]> {
        const features: TaskFeatureVector[] = [];
        
        for (const task of tasks) {
            const fv: TaskFeatureVector = {
                taskId: task.id,
                features: {
                    // Text features
                    titleLength: task.title.length,
                    descriptionLength: task.description.length,
                    wordCount: this.countWords(`${task.title} ${task.description}`),
                    keywordFrequency: this.extractKeywords(`${task.title} ${task.description}`),
                    
                    // Temporal features
                    creationHour: new Date(task.createdAt).getHours(),
                    creationDayOfWeek: new Date(task.createdAt).getDay(),
                    completionTime: this.calculateCompletionTime(task),
                    ageInHours: (Date.now() - new Date(task.createdAt).getTime()) / (1000 * 60 * 60),
                    
                    // Structural features
                    dependencyCount: task.dependencies?.length || 0,
                    collaboratorCount: task.collaborators?.length || 0,
                    watcherCount: task.watchers?.length || 0,
                    
                    // Priority features
                    priorityScore: this.getPriorityScore(task.priority),
                    
                    // Status features
                    isCompleted: task.status === "done",
                    statusChanges: this.countStatusChanges(task),
                    
                    // Assignment features
                    isAssigned: !!task.assignedTo,
                    assigneeWorkload: await this.calculateAssigneeWorkload(task),
                },
            };
            
            features.push(fv);
        }
        
        return features;
    }

    private async performClustering(features: TaskFeatureVector[]): Promise<Cluster[]> {
        const clusters: Cluster[] = [];
        
        // Simple k-means clustering implementation
        const k = Math.min(5, Math.max(2, Math.floor(features.length / 3)));
        const centroids = this.initializeKMeansCentroids(features, k);
        
        // Run k-means iterations
        for (let iteration = 0; iteration < 10; iteration++) {
            const assignments = new Map<number, string[]>();
            
            // Assign each feature to nearest centroid
            for (const feature of features) {
                const nearestCluster = this.findNearestCentroid(feature, centroids);
                if (!assignments.has(nearestCluster)) {
                    assignments.set(nearestCluster, []);
                }
                assignments.get(nearestCluster)!.push(feature.taskId);
            }
            
            // Update centroids
            for (let i = 0; i < k; i++) {
                const clusterTasks = assignments.get(i) || [];
                if (clusterTasks.length > 0) {
                    const clusterFeatures = clusterTasks.map(taskId => 
                        this.featureCache.get(taskId)!
                    );
                    centroids[i] = this.calculateCentroid(clusterFeatures);
                }
            }
        }
        
        // Create cluster objects
        for (let i = 0; i < k; i++) {
            const clusterTasks = features.filter(f => 
                this.findNearestCentroid(f, centroids) === i
            ).map(f => f.taskId);
            
            if (clusterTasks.length > 0) {
                const clusterFeatures = clusterTasks.map(taskId => 
                    this.featureCache.get(taskId)!
                );
                
                clusters.push({
                    id: `cluster_${i}`,
                    centroid: centroids[i],
                    tasks: clusterTasks,
                    label: this.generateClusterLabel(centroids[i], clusterTasks),
                    confidence: this.calculateClusterConfidence(clusterFeatures),
                });
            }
        }
        
        return clusters;
    }

    private async findSequentialPatterns(tasks: Task[]): Promise<SequencePattern[]> {
        const patterns: SequencePattern[] = [];
        
        // Sort tasks by completion time
        const completedTasks = tasks
            .filter(task => task.status === "done")
            .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
        
        // Look for common sequences using sliding window
        const sequenceLength = 3;
        const sequences = new Map<string, { count: number; examples: string[][] }>();
        
        for (let i = 0; i <= completedTasks.length - sequenceLength; i++) {
            const sequence = completedTasks.slice(i, i + sequenceLength);
            const sequenceKey = this.generateSequenceKey(sequence);
            
            if (!sequences.has(sequenceKey)) {
                sequences.set(sequenceKey, { count: 0, examples: [] });
            }
            
            const seqData = sequences.get(sequenceKey)!;
            seqData.count++;
            seqData.examples.push(sequence.map(t => t.id));
        }
        
        // Convert to pattern objects
        for (const [key, data] of sequences) {
            if (data.count >= 2) { // Only consider sequences that appear at least twice
                const avgCompletionTime = this.calculateAverageSequenceCompletionTime(data.examples);
                const successRate = this.calculateSequenceSuccessRate(data.examples);
                
                patterns.push({
                    id: randomUUID(),
                    sequence: data.examples[0], // Use first example as representative
                    frequency: data.count,
                    confidence: Math.min(1, data.count / 10), // Confidence based on frequency
                    context: this.generateSequenceContext(data.examples[0]),
                    avgCompletionTime,
                    successRate,
                });
            }
        }
        
        return patterns.sort((a, b) => b.confidence - a.confidence);
    }

    private async analyzeDependencyPatterns(tasks: Task[]): Promise<DependencyPattern[]> {
        const patterns: DependencyPattern[] = [];
        const dependencyPairs = new Map<string, {
            fromTask: string;
            toTask: string;
            count: number;
            delays: number[];
        }>();
        
        for (const task of tasks) {
            if (task.dependencies && task.dependencies.length > 0) {
                for (const depId of task.dependencies) {
                    const depTask = this.taskCache.get(depId);
                    const currentTask = task;
                    
                    if (depTask && currentTask) {
                        const pairKey = `${depId}->${task.id}`;
                        
                        if (!dependencyPairs.has(pairKey)) {
                            dependencyPairs.set(pairKey, {
                                fromTask: depId,
                                toTask: task.id,
                                count: 0,
                                delays: [],
                            });
                        }
                        
                        const pair = dependencyPairs.get(pairKey)!;
                        pair.count++;
                        
                        // Calculate delay if both tasks are completed
                        if (depTask.status === "done" && currentTask.status === "done") {
                            const depCompletion = new Date(depTask.updatedAt).getTime();
                            const currentCompletion = new Date(currentTask.updatedAt).getTime();
                            pair.delays.push(currentCompletion - depCompletion);
                        }
                    }
                }
            }
        }
        
        // Convert to pattern objects
        for (const [key, data] of dependencyPairs) {
            if (data.count >= 2) {
                const avgDelay = data.delays.length > 0 
                    ? data.delays.reduce((sum, delay) => sum + delay, 0) / data.delays.length
                    : 0;
                
                patterns.push({
                    id: randomUUID(),
                    fromTask: data.fromTask,
                    toTask: data.toTask,
                    frequency: data.count,
                    confidence: Math.min(1, data.count / 5),
                    type: this.determineDependencyType(data.fromTask, data.toTask, avgDelay),
                    avgDelay,
                });
            }
        }
        
        return patterns.sort((a, b) => b.confidence - a.confidence);
    }

    private convertToTaskPatterns(): TaskPattern[] {
        const patterns: TaskPattern[] = [];
        
        // Convert clusters to patterns
        for (const cluster of this.clusters) {
            if (cluster.confidence > 0.5) {
                patterns.push({
                    id: cluster.id,
                    name: `Task Cluster: ${cluster.label}`,
                    description: `Group of ${cluster.tasks.length} similar tasks`,
                    type: "skill_based",
                    frequency: cluster.tasks.length,
                    confidence: cluster.confidence,
                    tasks: cluster.tasks,
                    conditions: this.generateClusterConditions(cluster),
                    outcomes: {
                        successRate: this.calculateClusterSuccessRate(cluster.tasks),
                        averageDuration: this.calculateClusterAverageDuration(cluster.tasks),
                        commonIssues: this.identifyClusterIssues(cluster.tasks),
                    },
                    createdAt: new Date(),
                    lastSeen: new Date(),
                    isActive: true,
                });
            }
        }
        
        // Convert sequences to patterns
        for (const sequence of this.sequences) {
            patterns.push({
                id: sequence.id,
                name: `Task Sequence Pattern`,
                description: `Common sequence of ${sequence.sequence.length} tasks`,
                type: "sequential",
                frequency: sequence.frequency,
                confidence: sequence.confidence,
                tasks: sequence.sequence,
                conditions: [`Context: ${sequence.context}`],
                outcomes: {
                    successRate: sequence.successRate,
                    averageDuration: sequence.avgCompletionTime,
                    commonIssues: [],
                },
                createdAt: new Date(),
                lastSeen: new Date(),
                isActive: true,
            });
        }
        
        // Convert dependency patterns to patterns
        for (const dep of this.dependencies) {
            patterns.push({
                id: dep.id,
                name: `Dependency Pattern`,
                description: `Common ${dep.type} dependency relationship`,
                type: "dependency",
                frequency: dep.frequency,
                confidence: dep.confidence,
                tasks: [dep.fromTask, dep.toTask],
                conditions: [`Type: ${dep.type}`],
                outcomes: {
                    successRate: 0.8, // Placeholder
                    averageDuration: dep.avgDelay,
                    commonIssues: [],
                },
                createdAt: new Date(),
                lastSeen: new Date(),
                isActive: true,
            });
        }
        
        return patterns;
    }

    // Helper methods
    private countWords(text: string): number {
        return text.trim().split(/\s+/).length;
    }

    private extractKeywords(text: string): Record<string, number> {
        const words = text.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 3);
        
        const frequency: Record<string, number> = {};
        for (const word of words) {
            frequency[word] = (frequency[word] || 0) + 1;
        }
        
        return frequency;
    }

    private extractKeywordsFromText(text: string): Record<string, number> {
        return this.extractKeywords(text);
    }

    private calculateCompletionTime(task: Task): number | undefined {
        if (task.status === "done") {
            const created = new Date(task.createdAt).getTime();
            const updated = new Date(task.updatedAt).getTime();
            return (updated - created) / (1000 * 60); // in minutes
        }
        return undefined;
    }

    private getPriorityScore(priority: TaskPriority): number {
        switch (priority) {
            case "high": return 3;
            case "medium": return 2;
            case "low": return 1;
            default: return 2;
        }
    }

    private countStatusChanges(task: Task): number {
        return task.actionLog?.length || 0;
    }

    private async calculateAssigneeWorkload(task: Task): Promise<number> {
        if (!task.assignedTo) return 0;
        
        const assigneeTasks = Array.from(this.taskCache.values()).filter(
            t => t.assignedTo === task.assignedTo && t.status !== "done"
        );
        
        return assigneeTasks.length;
    }

    private initializeKMeansCentroids(features: TaskFeatureVector[], k: number): TaskFeatureVector["features"][] {
        const centroids: TaskFeatureVector["features"][] = [];
        
        // Initialize with random features
        for (let i = 0; i < k; i++) {
            const randomFeature = features[Math.floor(Math.random() * features.length)];
            centroids.push({ ...randomFeature.features });
        }
        
        return centroids;
    }

    private findNearestCentroid(feature: TaskFeatureVector, centroids: TaskFeatureVector["features"][]): number {
        let minDistance = Infinity;
        let nearestIndex = 0;
        
        for (let i = 0; i < centroids.length; i++) {
            const distance = this.calculateFeatureDistance(feature.features, centroids[i]);
            if (distance < minDistance) {
                minDistance = distance;
                nearestIndex = i;
            }
        }
        
        return nearestIndex;
    }

    private calculateFeatureDistance(f1: TaskFeatureVector["features"], f2: TaskFeatureVector["features"]): number {
        // Simple Euclidean distance on normalized features
        let distance = 0;
        
        // Normalize and compare numeric features
        distance += Math.pow((f1.titleLength - f2.titleLength) / 100, 2);
        distance += Math.pow((f1.descriptionLength - f2.descriptionLength) / 1000, 2);
        distance += Math.pow((f1.wordCount - f2.wordCount) / 100, 2);
        distance += Math.pow((f1.dependencyCount - f2.dependencyCount) / 10, 2);
        distance += Math.pow((f1.priorityScore - f2.priorityScore) / 3, 2);
        distance += Math.pow((f1.isCompleted ? 1 : 0) - (f2.isCompleted ? 1 : 0), 2);
        
        return Math.sqrt(distance);
    }

    private calculateCentroid(features: TaskFeatureVector[]): TaskFeatureVector["features"] {
        const centroid: TaskFeatureVector["features"] = {
            titleLength: 0,
            descriptionLength: 0,
            wordCount: 0,
            keywordFrequency: {},
            creationHour: 0,
            creationDayOfWeek: 0,
            completionTime: 0,
            ageInHours: 0,
            dependencyCount: 0,
            collaboratorCount: 0,
            watcherCount: 0,
            priorityScore: 0,
            isCompleted: false,
            statusChanges: 0,
            isAssigned: false,
            assigneeWorkload: 0,
        };
        
        const count = features.length;
        if (count === 0) return centroid;
        
        // Average numeric features
        for (const feature of features) {
            centroid.titleLength += feature.features.titleLength;
            centroid.descriptionLength += feature.features.descriptionLength;
            centroid.wordCount += feature.features.wordCount;
            centroid.creationHour += feature.features.creationHour;
            centroid.creationDayOfWeek += feature.features.creationDayOfWeek;
            if (feature.features.completionTime) {
                centroid.completionTime += feature.features.completionTime;
            }
            centroid.ageInHours += feature.features.ageInHours;
            centroid.dependencyCount += feature.features.dependencyCount;
            centroid.collaboratorCount += feature.features.collaboratorCount;
            centroid.watcherCount += feature.features.watcherCount;
            centroid.priorityScore += feature.features.priorityScore;
            if (feature.features.isCompleted) centroid.isCompleted = true;
            centroid.statusChanges += feature.features.statusChanges;
            if (feature.features.isAssigned) centroid.isAssigned = true;
            if (feature.features.assigneeWorkload) {
                centroid.assigneeWorkload += feature.features.assigneeWorkload;
            }
        }
        
        centroid.titleLength /= count;
        centroid.descriptionLength /= count;
        centroid.wordCount /= count;
        centroid.creationHour /= count;
        centroid.creationDayOfWeek /= count;
        if (centroid.completionTime > 0) centroid.completionTime /= count;
        centroid.ageInHours /= count;
        centroid.dependencyCount /= count;
        centroid.collaboratorCount /= count;
        centroid.watcherCount /= count;
        centroid.priorityScore /= count;
        centroid.statusChanges /= count;
        if (centroid.assigneeWorkload > 0) centroid.assigneeWorkload /= count;
        
        return centroid;
    }

    private generateClusterLabel(centroid: TaskFeatureVector["features"], tasks: string[]): string {
        const taskExamples = tasks.slice(0, 3).map(taskId => {
            const task = this.taskCache.get(taskId);
            return task ? task.title : taskId;
        });
        
        if (centroid.priorityScore > 2.5) {
            return "High Priority Tasks";
        } else if (centroid.dependencyCount > 2) {
            return "Complex Tasks with Dependencies";
        } else if (centroid.isCompleted) {
            return "Completed Tasks";
        } else {
            return "Standard Tasks";
        }
    }

    private calculateClusterConfidence(features: TaskFeatureVector[]): number {
        if (features.length === 0) return 0;
        
        // Calculate cohesion (how similar tasks are within cluster)
        let totalDistance = 0;
        let comparisons = 0;
        
        for (let i = 0; i < features.length; i++) {
            for (let j = i + 1; j < features.length; j++) {
                totalDistance += this.calculateFeatureDistance(features[i].features, features[j].features);
                comparisons++;
            }
        }
        
        const avgDistance = comparisons > 0 ? totalDistance / comparisons : 0;
        return Math.max(0, 1 - avgDistance / 2); // Normalize to [0,1]
    }

    private generateClusterConditions(cluster: Cluster): string[] {
        const conditions: string[] = [];
        const centroid = cluster.centroid;
        
        if (centroid.priorityScore > 2.5) {
            conditions.push("High priority tasks");
        }
        
        if (centroid.dependencyCount > 2) {
            conditions.push("Tasks with multiple dependencies");
        }
        
        if (centroid.isAssigned) {
            conditions.push("Assigned tasks");
        }
        
        return conditions;
    }

    private calculateClusterSuccessRate(taskIds: string[]): number {
        const completedTasks = taskIds.filter(taskId => {
            const task = this.taskCache.get(taskId);
            return task && task.status === "done";
        });
        
        return taskIds.length > 0 ? completedTasks.length / taskIds.length : 0;
    }

    private calculateClusterAverageDuration(taskIds: string[]): number {
        const completedTasks = taskIds
            .map(taskId => this.taskCache.get(taskId))
            .filter(task => task && task.status === "done") as Task[];
        
        if (completedTasks.length === 0) return 0;
        
        const totalDuration = completedTasks.reduce((sum, task) => {
            const duration = this.calculateCompletionTime(task);
            return sum + (duration || 0);
        }, 0);
        
        return totalDuration / completedTasks.length;
    }

    private identifyClusterIssues(taskIds: string[]): string[] {
        const issues: string[] = [];
        
        const failedTasks = taskIds.filter(taskId => {
            const task = this.taskCache.get(taskId);
            return task && task.status === "invalid";
        });
        
        if (failedTasks.length > 0) {
            issues.push(`${failedTasks.length} tasks failed`);
        }
        
        const oldTasks = taskIds.filter(taskId => {
            const task = this.taskCache.get(taskId);
            if (!task || task.status === "done") return false;
            const ageHours = (Date.now() - new Date(task.createdAt).getTime()) / (1000 * 60 * 60);
            return ageHours > 24 * 7; // Older than 7 days
        });
        
        if (oldTasks.length > 0) {
            issues.push(`${oldTasks.length} tasks older than 7 days`);
        }
        
        return issues;
    }

    private generateSequenceKey(sequence: Task[]): string {
        return sequence.map(task => {
            const keywords = this.extractKeywordsFromText(task.title);
            return Object.keys(keywords).slice(0, 3).join("-");
        }).join(" -> ");
    }

    private calculateAverageSequenceCompletionTime(examples: string[][]): number {
        const completionTimes: number[] = [];
        
        for (const example of examples) {
            let totalTime = 0;
            for (const taskId of example) {
                const task = this.taskCache.get(taskId);
                if (task && task.status === "done") {
                    const duration = this.calculateCompletionTime(task);
                    if (duration) totalTime += duration;
                }
            }
            if (totalTime > 0) {
                completionTimes.push(totalTime);
            }
        }
        
        return completionTimes.length > 0 
            ? completionTimes.reduce((sum, time) => sum + time, 0) / completionTimes.length
            : 0;
    }

    private calculateSequenceSuccessRate(examples: string[][]): number {
        let successfulSequences = 0;
        
        for (const example of examples) {
            const completedTasks = example.filter(taskId => {
                const task = this.taskCache.get(taskId);
                return task && task.status === "done";
            });
            
            if (completedTasks.length === example.length) {
                successfulSequences++;
            }
        }
        
        return examples.length > 0 ? successfulSequences / examples.length : 0;
    }

    private generateSequenceContext(example: string[]): string {
        const tasks = example.map(taskId => this.taskCache.get(taskId)).filter(Boolean) as Task[];
        
        if (tasks.length === 0) return "Unknown context";
        
        const contexts: string[] = [];
        
        const hasHighPriority = tasks.some(task => task.priority === "high");
        if (hasHighPriority) contexts.push("high-priority");
        
        const hasDependencies = tasks.some(task => task.dependencies && task.dependencies.length > 0);
        if (hasDependencies) contexts.push("dependent");
        
        const assignees = new Set(tasks.map(task => task.assignedTo).filter(Boolean));
        if (assignees.size > 1) contexts.push("multi-user");
        
        return contexts.join(", ") || "general";
    }

    private determineDependencyType(fromTask: string, toTask: string, avgDelay: number): "sequential" | "parallel" | "blocking" {
        const from = this.taskCache.get(fromTask);
        const to = this.taskCache.get(toTask);
        
        if (!from || !to) return "sequential";
        
        // If tasks have significant temporal separation, likely sequential
        if (avgDelay > 60 * 60 * 1000) { // More than 1 hour
            return "sequential";
        }
        
        // If to task depends on from and from blocks to progress
        if (to.dependencies?.includes(fromTask)) {
            return "blocking";
        }
        
        return "parallel";
    }

    private isPatternRelevantToUser(pattern: TaskPattern, userId: string): boolean {
        for (const taskId of pattern.tasks) {
            const task = this.taskCache.get(taskId);
            if (task && (task.assignedTo === userId || task.createdBy === userId)) {
                return true;
            }
        }
        return false;
    }

    private isPatternRelevantToText(pattern: TaskPattern, text: string): boolean {
        const textLower = text.toLowerCase();
        const keywords = this.extractKeywords(text);
        
        for (const taskId of pattern.tasks) {
            const task = this.taskCache.get(taskId);
            if (task) {
                const taskText = `${task.title} ${task.description}`.toLowerCase();
                const taskKeywords = this.extractKeywords(taskText);
                
                // Check for keyword overlap
                const overlap = Object.keys(keywords).filter(keyword => taskKeywords[keyword]);
                if (overlap.length > 0) {
                    return true;
                }
            }
        }
        
        return false;
    }
}