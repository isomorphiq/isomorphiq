import type { Result } from "@isomorphiq/core";
import { ValidationError } from "@isomorphiq/core";
import {
    StoryPrioritizationDomainRules,
    StoryPrioritizationFactory,
} from "./story-prioritization-domain.ts";
import type {
    PriorityCriterion,
    PriorityScore,
    StoryPriorityEvaluation,
    PriorityConflict,
    PriorityHistoryEntry,
    PriorityRecommendation,
} from "./story-prioritization-types.ts";

export interface PriorityEvaluationServiceConfig {
    minCriteria: number;
    maxCriteria: number;
    minWeight: number;
    maxWeight: number;
    weightSumTolerance: number;
    enableAutoConflictResolution: boolean;
    enableRecommendations: boolean;
    maxHistoryEntries: number;
}

export const defaultPriorityEvaluationConfig: PriorityEvaluationServiceConfig = {
    minCriteria: 3,
    maxCriteria: 6,
    minWeight: 0.05,
    maxWeight: 0.5,
    weightSumTolerance: 0.01,
    enableAutoConflictResolution: false,
    enableRecommendations: true,
    maxHistoryEntries: 100,
};

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PriorityEvaluationService {
    private config: PriorityEvaluationServiceConfig;
    private evaluations: Map<string, StoryPriorityEvaluation> = new Map();
    private scores: Map<string, PriorityScore> = new Map();
    private conflicts: Map<string, PriorityConflict> = new Map();
    private history: Map<string, PriorityHistoryEntry[]> = new Map();

    constructor(config: Partial<PriorityEvaluationServiceConfig> = {}) {
        this.config = { ...defaultPriorityEvaluationConfig, ...config };
    }

    evaluateStoryPriority(
        storyId: string,
        criteria: PriorityCriterion[],
        evaluatedBy: string,
    ): Result<PriorityScore> {
        const scoreResult = StoryPrioritizationFactory.createPriorityScore(
            storyId,
            criteria,
            evaluatedBy,
        );

        if (!scoreResult.success) {
            return scoreResult;
        }

        const score = scoreResult.data;
        this.scores.set(storyId, score);

        const evaluation = StoryPrioritizationFactory.createPriorityEvaluation(storyId, evaluatedBy);
        evaluation.status = "completed";
        evaluation.score = score;
        evaluation.completedAt = new Date();
        this.evaluations.set(evaluation.id, evaluation);

        return { success: true, data: score };
    }

    calculatePriorityScore(criteria: PriorityCriterion[]): Result<number> {
        const validation = StoryPrioritizationDomainRules.validateCriteria(criteria, {
            minCriteria: this.config.minCriteria,
            maxCriteria: this.config.maxCriteria,
            minWeight: this.config.minWeight,
            maxWeight: this.config.maxWeight,
            weightSumTolerance: this.config.weightSumTolerance,
        });

        if (!validation.success) {
            return { success: false, error: validation.error };
        }

        const score = StoryPrioritizationDomainRules.calculateWeightedScore(criteria);
        return { success: true, data: score };
    }

    detectPriorityConflicts(
        storyId: string,
        newPriority: "low" | "medium" | "high",
        dependencies: string[],
        allStories: Array<{ id: string; priority: "low" | "medium" | "high"; dependencies: string[] }>,
    ): PriorityConflict[] {
        return StoryPrioritizationDomainRules.detectPriorityConflicts(
            storyId,
            newPriority,
            dependencies,
            allStories,
        );
    }

    resolvePriorityConflict(
        conflictId: string,
        resolutionStrategy: "auto_resolve" | "manual_review" | "stakeholder_vote" | "escalate_to_leadership",
        resolvedBy: string,
    ): Result<PriorityConflict> {
        const conflict = this.conflicts.get(conflictId);
        if (!conflict) {
            return {
                success: false,
                error: new ValidationError(`Conflict ${conflictId} not found`, "conflictId"),
            };
        }

        conflict.resolution = "resolved";
        conflict.resolutionStrategy = resolutionStrategy;
        conflict.resolvedAt = new Date();
        conflict.resolvedBy = resolvedBy;

        this.conflicts.set(conflictId, conflict);
        return { success: true, data: conflict };
    }

    suggestPriorityAdjustments(
        storyId: string,
        currentCriteria: PriorityCriterion[],
        allStories: Array<{ id: string; priority: "low" | "medium" | "high"; criteria: PriorityCriterion[] }>,
    ): Result<PriorityRecommendation> {
        if (!this.config.enableRecommendations) {
            return {
                success: false,
                error: new ValidationError("Recommendations are disabled", "config"),
            };
        }

        const currentScoreResult = this.calculatePriorityScore(currentCriteria);
        if (!currentScoreResult.success) {
            return {
                success: false,
                error: currentScoreResult.error,
            };
        }

        const currentScore = currentScoreResult.data;
        const currentPriority = StoryPrioritizationDomainRules.determinePriorityFromScore(currentScore);

        const similarStories = allStories.filter(
            (s) =>
                s.id !== storyId &&
                s.criteria.some((c) => currentCriteria.some((cc) => cc.type === c.type)),
        );

        let recommendedScore = currentScore;
        const reasoning: string[] = [];
        const factors: Array<{ factor: string; impact: "positive" | "negative" | "neutral"; weight: number }> = [];

        if (similarStories.length > 0) {
            const avgScore =
                similarStories.reduce((sum, s) => {
                    const score = StoryPrioritizationDomainRules.calculateWeightedScore(s.criteria);
                    return sum + score;
                }, 0) / similarStories.length;

            if (Math.abs(currentScore - avgScore) > 2) {
                if (currentScore < avgScore) {
                    reasoning.push(`Score is ${(avgScore - currentScore).toFixed(1)} points below similar stories`);
                    factors.push({ factor: "peer_comparison", impact: "negative", weight: 0.3 });
                } else {
                    reasoning.push(`Score is ${(currentScore - avgScore).toFixed(1)} points above similar stories`);
                    factors.push({ factor: "peer_comparison", impact: "positive", weight: 0.3 });
                }

                recommendedScore = (currentScore + avgScore) / 2;
            }
        }

        const lowScores = currentCriteria.filter((c) => c.score < 4);
        if (lowScores.length > 0) {
            reasoning.push(`${lowScores.length} criteria scored below 4, consider re-evaluation`);
            factors.push({ factor: "low_criteria_scores", impact: "negative", weight: 0.2 });
        }

        const highWeightLowScore = currentCriteria.filter((c) => c.weight > 0.3 && c.score < 5);
        if (highWeightLowScore.length > 0) {
            reasoning.push(`${highWeightLowScore.length} high-weight criteria have low scores`);
            factors.push({ factor: "high_weight_low_score", impact: "negative", weight: 0.4 });
        }

        const recommendedPriority = StoryPrioritizationDomainRules.determinePriorityFromScore(recommendedScore);

        const confidence = Math.min(1, 0.5 + factors.length * 0.1);

        const recommendation: PriorityRecommendation = {
            storyId,
            currentPriority,
            recommendedPriority,
            currentScore,
            recommendedScore,
            confidence,
            reasoning,
            factors,
            generatedAt: new Date(),
            generatedBy: "priority-evaluation-service",
        };

        return { success: true, data: recommendation };
    }

    trackPriorityHistory(entry: PriorityHistoryEntry): void {
        const storyHistory = this.history.get(entry.storyId) || [];
        storyHistory.push(entry);

        if (storyHistory.length > this.config.maxHistoryEntries) {
            storyHistory.shift();
        }

        this.history.set(entry.storyId, storyHistory);
    }

    getPriorityHistory(storyId: string): PriorityHistoryEntry[] {
        return this.history.get(storyId) || [];
    }

    getPriorityScore(storyId: string): PriorityScore | undefined {
        return this.scores.get(storyId);
    }

    getEvaluation(evaluationId: string): StoryPriorityEvaluation | undefined {
        return this.evaluations.get(evaluationId);
    }

    getConflictsForStory(storyId: string): PriorityConflict[] {
        return Array.from(this.conflicts.values()).filter(
            (c) => c.storyId === storyId || c.conflictingStoryId === storyId,
        );
    }

    getPendingConflicts(): PriorityConflict[] {
        return Array.from(this.conflicts.values()).filter((c) => c.resolution === "pending");
    }

    batchEvaluatePriorities(
        evaluations: Array<{ storyId: string; criteria: PriorityCriterion[]; evaluatedBy: string }>,
    ): Result<Map<string, PriorityScore>> {
        const results = new Map<string, PriorityScore>();
        const errors: string[] = [];

        for (const evalData of evaluations) {
            const result = this.evaluateStoryPriority(
                evalData.storyId,
                evalData.criteria,
                evalData.evaluatedBy,
            );

            if (result.success) {
                results.set(evalData.storyId, result.data);
            } else {
                errors.push(`${evalData.storyId}: ${result.error.message}`);
            }
        }

        if (errors.length > 0 && errors.length === evaluations.length) {
            return {
                success: false,
                error: new ValidationError(`All evaluations failed: ${errors.join("; ")}`, "batch"),
            };
        }

        return { success: true, data: results };
    }

    clearHistory(storyId: string): void {
        this.history.delete(storyId);
    }

    reset(): void {
        this.evaluations.clear();
        this.scores.clear();
        this.conflicts.clear();
        this.history.clear();
    }
}

