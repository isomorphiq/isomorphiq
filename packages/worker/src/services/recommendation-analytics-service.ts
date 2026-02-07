import type { IncomingMessage, ServerResponse } from "node:http";
import type { 
    TaskRecommendation, 
    RecommendationRequest, 
    RecommendationResponse, 
    RecommendationFilter,
    RecommendationAnalytics
} from "@isomorphiq/core";
import type { Task } from "@isomorphiq/tasks";
import type { ProductManager } from "@isomorphiq/profiles";
import { TaskRecommendationService, AdvancedPatternAnalyzer, SimpleLearningEngine } from "@isomorphiq/tasks";
import type { TaskServiceApi } from "@isomorphiq/tasks";

export interface RecommendationServiceConfig {
    maxRecommendationsPerRequest: number;
    defaultMinConfidence: number;
    cacheTimeoutMs: number;
    enableRealTimeUpdates: boolean;
    enableLearning: boolean;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class RecommendationAnalyticsService {
    private recommendationService: TaskRecommendationService;
    private productManager: ProductManager;
    private config: RecommendationServiceConfig;
    private realTimeSubscriptions: Map<string, Set<string>> = new Map(); // userId -> recommendationIds
    private lastRecommendations: Map<string, RecommendationResponse> = new Map(); // context -> response

    constructor(
        productManager: ProductManager,
        config: Partial<RecommendationServiceConfig> = {}
    ) {
        this.productManager = productManager;
        this.config = {
            maxRecommendationsPerRequest: 5,
            defaultMinConfidence: 0.3,
            cacheTimeoutMs: 5 * 60 * 1000, // 5 minutes
            enableRealTimeUpdates: true,
            enableLearning: true,
            ...config,
        };

        // Initialize recommendation service
        const patternAnalyzer = new AdvancedPatternAnalyzer();
        const learningEngine = new SimpleLearningEngine();
        
        // Get or create a basic TaskService for the recommendation system
        const taskService = productManager.taskService as TaskServiceApi;
        this.recommendationService = new TaskRecommendationService(
            taskService,
            patternAnalyzer,
            learningEngine,
        );
    }

    async initialize(): Promise<void> {
        console.log("[RECOMMENDATIONS] Initializing recommendation analytics service");
        
        // Initialize pattern analyzer with existing tasks
        const allTasks = await this.productManager.getAllTasks();
        await this.recommendationService["patternAnalyzer"].analyzePatterns(allTasks);
        
        console.log("[RECOMMENDATIONS] Recommendation analytics service initialized");
    }

    // HTTP API handlers
    async handleRecommendationRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        try {
            const url = new URL(req.url || "", `http://${req.headers.host}`);
            const pathParts = url.pathname.split("/").filter(p => p);

            if (pathParts[0] !== "api" || pathParts[1] !== "recommendations") {
                this.serve404(res);
                return;
            }

            const recommendationType = pathParts[2];
            const result = await this.processRecommendationRequest(recommendationType, url, req);

            res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
        } catch (error) {
            console.error("[RECOMMENDATIONS] Error handling request:", error);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Internal server error",
                timestamp: new Date().toISOString()
            }));
        }
    }

    private async processRecommendationRequest(
        type: string, 
        url: URL, 
        req: IncomingMessage
    ): Promise<any> {
        const timestamp = new Date().toISOString();

        try {
            switch (type) {
                case "task": {
                    const taskId = url.searchParams.get("taskId");
                    if (!taskId) {
                        return {
                            success: false,
                            error: "taskId parameter required",
                            timestamp
                        };
                    }

                    const maxRecommendations = parseInt(url.searchParams.get("max") || "5");
                    const response = await this.getRecommendationsForTask(taskId, maxRecommendations);
                    
                    return {
                        success: true,
                        data: response,
                        timestamp
                    };
                }

                case "user": {
                    const userId = url.searchParams.get("userId");
                    if (!userId) {
                        return {
                            success: false,
                            error: "userId parameter required",
                            timestamp
                        };
                    }

                    const maxRecommendations = parseInt(url.searchParams.get("max") || "5");
                    const response = await this.getRecommendationsForUser(userId, maxRecommendations);
                    
                    return {
                        success: true,
                        data: response,
                        timestamp
                    };
                }

                case "context": {
                    const requestBody = await this.parseRequestBody(req);
                    const request: RecommendationRequest = {
                        context: requestBody.context || {},
                        maxRecommendations: requestBody.maxRecommendations || this.config.maxRecommendationsPerRequest,
                        types: requestBody.types,
                        minConfidence: requestBody.minConfidence || this.config.defaultMinConfidence,
                    };

                    const response = await this.recommendationService.getRecommendations(request);
                    
                    return {
                        success: true,
                        data: response,
                        timestamp
                    };
                }

                case "filter": {
                    const requestBody = await this.parseRequestBody(req);
                    const filter: RecommendationFilter = requestBody.filter || {};
                    const recommendations = await this.recommendationService.filterRecommendations(filter);
                    
                    return {
                        success: true,
                        data: {
                            recommendations,
                            total: recommendations.length,
                            filter,
                        },
                        timestamp
                    };
                }

                case "analytics": {
                    const analytics = await this.getComprehensiveAnalytics();
                    return {
                        success: true,
                        data: analytics,
                        timestamp
                    };
                }

                case "apply": {
                    const requestBody = await this.parseRequestBody(req);
                    const recommendationId = requestBody.recommendationId;
                    
                    if (!recommendationId) {
                        return {
                            success: false,
                            error: "recommendationId parameter required",
                            timestamp
                        };
                    }

                    const success = await this.recommendationService.applyRecommendation(recommendationId);
                    
                    return {
                        success: true,
                        data: { applied: success },
                        timestamp
                    };
                }

                case "dismiss": {
                    const requestBody = await this.parseRequestBody(req);
                    const { recommendationId, reason } = requestBody;
                    
                    if (!recommendationId) {
                        return {
                            success: false,
                            error: "recommendationId parameter required",
                            timestamp
                        };
                    }

                    const success = await this.recommendationService.dismissRecommendation(recommendationId, reason);
                    
                    return {
                        success: true,
                        data: { dismissed: success },
                        timestamp
                    };
                }

                case "patterns": {
                    const patterns = await this.getTaskPatterns();
                    return {
                        success: true,
                        data: patterns,
                        timestamp
                    };
                }

                default:
                    return {
                        success: false,
                        error: `Unknown recommendation endpoint: ${type}`,
                        timestamp
                    };
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                timestamp
            };
        }
    }

    // Public API methods
    async getRecommendationsForTask(taskId: string, maxRecommendations: number = 5): Promise<RecommendationResponse> {
        const response = await this.recommendationService.getRecommendationsForTask(taskId, maxRecommendations);
        
        // Cache for real-time updates
        this.lastRecommendations.set(`task_${taskId}`, response);
        
        return response;
    }

    async getRecommendationsForUser(userId: string, maxRecommendations: number = 5): Promise<RecommendationResponse> {
        const response = await this.recommendationService.getRecommendationsForUser(userId, maxRecommendations);
        
        // Cache for real-time updates
        this.lastRecommendations.set(`user_${userId}`, response);
        
        // Subscribe user to real-time updates
        if (this.config.enableRealTimeUpdates) {
            this.subscribeUserToRecommendations(userId, response.recommendations.map(r => r.id));
        }
        
        return response;
    }

    async getComprehensiveAnalytics(): Promise<RecommendationAnalytics & {
        trends: {
            daily: Array<{ date: string; count: number; applied: number }>;
            byType: Record<string, number>;
            byPriority: Record<string, number>;
        };
        performance: {
            averageProcessingTime: number;
            successRate: number;
            userEngagement: number;
        };
        insights: Array<{
            type: string;
            title: string;
            description: string;
            impact: string;
        }>;
    }> {
        const analytics = await this.recommendationService.getAnalytics();
        
        // Generate additional analytics
        const trends = await this.generateRecommendationTrends();
        const performance = await this.calculatePerformanceMetrics();
        const insights = await this.generateInsights(analytics);
        
        return {
            ...analytics,
            trends,
            performance,
            insights,
        };
    }

    async getTaskPatterns(): Promise<any> {
        const allTasks = await this.productManager.getAllTasks();
        const patternAnalyzer = this.recommendationService["patternAnalyzer"];
        
        if (patternAnalyzer.analyzePatterns) {
            const patterns = await patternAnalyzer.analyzePatterns(allTasks);
            return {
                patterns,
                totalTasks: allTasks.length,
                analyzedAt: new Date(),
            };
        }
        
        return { patterns: [], totalTasks: allTasks.length, analyzedAt: new Date() };
    }

    // Real-time update methods
    subscribeUserToRecommendations(userId: string, recommendationIds: string[]): void {
        if (!this.realTimeSubscriptions.has(userId)) {
            this.realTimeSubscriptions.set(userId, new Set());
        }
        
        const subscription = this.realTimeSubscriptions.get(userId)!;
        recommendationIds.forEach(id => subscription.add(id));
        
        console.log(`[RECOMMENDATIONS] User ${userId} subscribed to ${recommendationIds.length} recommendations`);
    }

    unsubscribeUserFromRecommendations(userId: string, recommendationIds: string[]): void {
        const subscription = this.realTimeSubscriptions.get(userId);
        if (subscription) {
            recommendationIds.forEach(id => subscription.delete(id));
            
            if (subscription.size === 0) {
                this.realTimeSubscriptions.delete(userId);
            }
        }
        
        console.log(`[RECOMMENDATIONS] User ${userId} unsubscribed from ${recommendationIds.length} recommendations`);
    }

    // Integration with task monitoring
    async onTaskCreated(task: Task): Promise<void> {
        if (!this.config.enableRealTimeUpdates) return;
        
        // Generate recommendations for the new task
        try {
            const response = await this.getRecommendationsForTask(task.id, 3);
            
            if (response.recommendations.length > 0) {
                console.log(`[RECOMMENDATIONS] Generated ${response.recommendations.length} recommendations for new task: ${task.title}`);
                
                // Emit event for real-time updates
                this.emitRecommendationEvent("task_recommendations", {
                    taskId: task.id,
                    recommendations: response.recommendations,
                });
            }
        } catch (error) {
            console.error("[RECOMMENDATIONS] Error generating recommendations for new task:", error);
        }
    }

    async onTaskStatusChanged(taskId: string, oldStatus: string, newStatus: string): Promise<void> {
        if (!this.config.enableRealTimeUpdates) return;
        
        // Update recommendations if task status changed significantly
        if (oldStatus !== newStatus) {
            try {
                const response = await this.getRecommendationsForTask(taskId, 3);
                
                // Emit event for real-time updates
                this.emitRecommendationEvent("task_status_recommendations", {
                    taskId,
                    oldStatus,
                    newStatus,
                    recommendations: response.recommendations,
                });
            } catch (error) {
                console.error("[RECOMMENDATIONS] Error updating recommendations on status change:", error);
            }
        }
    }

    async onUserActivity(userId: string, activity: string): Promise<void> {
        if (!this.config.enableRealTimeUpdates) return;
        
        // Generate personalized recommendations based on user activity
        try {
            const response = await this.getRecommendationsForUser(userId, 2);
            
            this.emitRecommendationEvent("user_activity_recommendations", {
                userId,
                activity,
                recommendations: response.recommendations,
            });
        } catch (error) {
            console.error("[RECOMMENDATIONS] Error generating activity-based recommendations:", error);
        }
    }

    // Private helper methods
    private async parseRequestBody(req: IncomingMessage): Promise<any> {
        return new Promise((resolve, reject) => {
            let body = "";
            req.on("data", chunk => {
                body += chunk.toString();
            });
            req.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(error);
                }
            });
            req.on("error", reject);
        });
    }

    private async generateRecommendationTrends(): Promise<{
        daily: Array<{ date: string; count: number; applied: number }>;
        byType: Record<string, number>;
        byPriority: Record<string, number>;
    }> {
        // Generate mock trend data - in real implementation, this would query analytics
        const daily = [];
        const byType: Record<string, number> = {};
        const byPriority: Record<string, number> = {};
        
        // Generate last 7 days of data
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            daily.push({
                date: date.toISOString().split('T')[0],
                count: Math.floor(Math.random() * 20) + 5,
                applied: Math.floor(Math.random() * 15) + 2,
            });
        }
        
        // Mock distribution by type and priority
        const types = ["related_task", "dependency_suggestion", "priority_adjustment", "assignment_suggestion"];
        types.forEach(type => {
            byType[type] = Math.floor(Math.random() * 30) + 10;
        });
        
        const priorities = ["critical", "high", "medium", "low"];
        priorities.forEach(priority => {
            byPriority[priority] = Math.floor(Math.random() * 25) + 5;
        });
        
        return { daily, byType, byPriority };
    }

    private async calculatePerformanceMetrics(): Promise<{
        averageProcessingTime: number;
        successRate: number;
        userEngagement: number;
    }> {
        const analytics = await this.recommendationService.getAnalytics();
        
        const averageProcessingTime = 250; // Mock: 250ms
        const successRate = analytics.effectiveness.accuracy;
        const userEngagement = analytics.effectiveness.userSatisfaction;
        
        return {
            averageProcessingTime,
            successRate,
            userEngagement,
        };
    }

    private async generateInsights(analytics: RecommendationAnalytics): Promise<Array<{
        type: string;
        title: string;
        description: string;
        impact: string;
    }>> {
        const insights = [];
        
        // Generate insights based on analytics
        if (analytics.appliedRecommendations / analytics.totalRecommendations < 0.3) {
            insights.push({
                type: "engagement",
                title: "Low Recommendation Adoption",
                description: "Only 30% of recommendations are being applied by users",
                impact: "Consider improving recommendation quality or user interface",
            });
        }
        
        if (analytics.averageConfidence < 0.6) {
            insights.push({
                type: "quality",
                title: "Low Recommendation Confidence",
                description: "Average confidence score is below optimal threshold",
                impact: "Retrain models with more data or adjust algorithms",
            });
        }
        
        const topType = Object.entries(analytics.recommendationTypes)
            .sort(([, a], [, b]) => b - a)[0];
        
        if (topType) {
            insights.push({
                type: "pattern",
                title: `Most Common Recommendation: ${topType[0]}`,
                description: `${topType[1]} recommendations of this type have been generated`,
                impact: "Focus optimization efforts on this recommendation type",
            });
        }
        
        return insights;
    }

    private emitRecommendationEvent(eventType: string, data: any): void {
        // Emit event through global event bus for real-time updates
        try {
            const { globalEventBus } = require("@isomorphiq/core");
            globalEventBus.emit(eventType, data);
        } catch (error) {
            console.error("[RECOMMENDATIONS] Error emitting event:", error);
        }
    }

    private serve404(res: ServerResponse): void {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            success: false,
            error: "Recommendation endpoint not found",
            timestamp: new Date().toISOString()
        }));
    }

    // Configuration methods
    updateConfig(newConfig: Partial<RecommendationServiceConfig>): void {
        this.config = { ...this.config, ...newConfig };
        console.log("[RECOMMENDATIONS] Configuration updated:", this.config);
    }

    getConfig(): RecommendationServiceConfig {
        return { ...this.config };
    }
}

