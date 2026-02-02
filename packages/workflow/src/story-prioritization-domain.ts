import { z } from "zod";
import { struct } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import type { Result } from "@isomorphiq/core";
import { ValidationError } from "@isomorphiq/core";
import type {
    PriorityCriterion,
    PriorityScore,
    StoryPriorityEvaluation,
    PriorityConflict,
    PriorityHistoryEntry,
} from "./story-prioritization-types.ts";

export const PriorityCriterionValidationSchema = z.object({
    minCriteria: z.number().min(1).max(6).default(3),
    maxCriteria: z.number().min(1).max(6).default(6),
    minWeight: z.number().min(0.01).max(1).default(0.05),
    maxWeight: z.number().min(0.01).max(1).default(0.5),
    weightSumTolerance: z.number().min(0).max(0.1).default(0.01),
});

export const PriorityCriterionValidationStruct = struct.name("PriorityCriterionValidation")<
    z.output<typeof PriorityCriterionValidationSchema>,
    z.input<typeof PriorityCriterionValidationSchema>
>(PriorityCriterionValidationSchema);

export type PriorityCriterionValidation = StructSelf<typeof PriorityCriterionValidationStruct>;

export const StoryPrioritizationDomainRules = {
    validateCriteria(
        criteria: PriorityCriterion[],
        validation: PriorityCriterionValidation,
    ): Result<void> {
        if (criteria.length < validation.minCriteria) {
            return {
                success: false,
                error: new ValidationError(
                    `At least ${validation.minCriteria} criteria required, got ${criteria.length}`,
                    "criteria",
                ),
            };
        }

        if (criteria.length > validation.maxCriteria) {
            return {
                success: false,
                error: new ValidationError(
                    `Maximum ${validation.maxCriteria} criteria allowed, got ${criteria.length}`,
                    "criteria",
                ),
            };
        }

        const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
        const expectedSum = 1.0;
        if (Math.abs(totalWeight - expectedSum) > validation.weightSumTolerance) {
            return {
                success: false,
                error: new ValidationError(
                    `Criteria weights must sum to 1.0 (±${validation.weightSumTolerance}), got ${totalWeight.toFixed(2)}`,
                    "criteria",
                ),
            };
        }

        for (const criterion of criteria) {
            if (criterion.weight < validation.minWeight || criterion.weight > validation.maxWeight) {
                return {
                    success: false,
                    error: new ValidationError(
                        `Criterion weight must be between ${validation.minWeight} and ${validation.maxWeight}, got ${criterion.weight}`,
                        "criteria",
                    ),
                };
            }

            if (criterion.score < 0 || criterion.score > 10) {
                return {
                    success: false,
                    error: new ValidationError(
                        `Criterion score must be between 0 and 10, got ${criterion.score}`,
                        "criteria",
                    ),
                };
            }
        }

        return { success: true, data: undefined };
    },

    calculateWeightedScore(criteria: PriorityCriterion[]): number {
        return criteria.reduce((sum, criterion) => sum + criterion.score * criterion.weight, 0);
    },

    determinePriorityFromScore(score: number): "low" | "medium" | "high" {
        if (score >= 7) return "high";
        if (score >= 4) return "medium";
        return "low";
    },

    calculateConfidence(criteria: PriorityCriterion[]): number {
        if (criteria.length === 0) return 0;

        const hasJustifications = criteria.filter((c) => c.justification && c.justification.trim().length > 0).length;
        const justificationRatio = hasJustifications / criteria.length;

        const scoreVariance = this.calculateScoreVariance(criteria);
        const consistencyScore = Math.max(0, 1 - scoreVariance / 10);

        return Math.min(1, (justificationRatio * 0.4 + consistencyScore * 0.6));
    },

    calculateScoreVariance(criteria: PriorityCriterion[]): number {
        if (criteria.length < 2) return 0;

        const scores = criteria.map((c) => c.score);
        const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
        const squaredDiffs = scores.map((s) => Math.pow(s - mean, 2));
        const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / scores.length;

        return Math.sqrt(variance);
    },

    detectPriorityConflicts(
        storyId: string,
        newPriority: "low" | "medium" | "high",
        dependencies: string[],
        allStories: Array<{ id: string; priority: "low" | "medium" | "high"; dependencies: string[] }>,
    ): PriorityConflict[] {
        const conflicts: PriorityConflict[] = [];

        const storyPriorityWeight = { low: 1, medium: 2, high: 3 };
        const newPriorityWeight = storyPriorityWeight[newPriority];

        for (const depId of dependencies) {
            const depStory = allStories.find((s) => s.id === depId);
            if (depStory) {
                const depPriorityWeight = storyPriorityWeight[depStory.priority];
                if (newPriorityWeight > depPriorityWeight) {
                    conflicts.push({
                        id: `conflict-${storyId}-${depId}`,
                        type: "dependency_conflict",
                        storyId,
                        conflictingStoryId: depId,
                        description: `Story ${storyId} has higher priority (${newPriority}) than dependency ${depId} (${depStory.priority})`,
                        detectedAt: new Date(),
                        detectedBy: "system",
                        severity: "medium",
                        resolution: "pending",
                    } as PriorityConflict);
                }
            }
        }

        const dependentStories = allStories.filter((s) => s.dependencies.includes(storyId));
        for (const dependent of dependentStories) {
            const dependentPriorityWeight = storyPriorityWeight[dependent.priority];
            if (newPriorityWeight < dependentPriorityWeight) {
                conflicts.push({
                    id: `conflict-${dependent.id}-${storyId}`,
                    type: "dependency_conflict",
                    storyId: dependent.id,
                    conflictingStoryId: storyId,
                    description: `Story ${dependent.id} depends on ${storyId} but has higher priority (${dependent.priority} vs ${newPriority})`,
                    detectedAt: new Date(),
                    detectedBy: "system",
                    severity: "high",
                    resolution: "pending",
                } as PriorityConflict);
            }
        }

        return conflicts;
    },

    canTransitionEvaluationStatus(
        from: StoryPriorityEvaluation["status"],
        to: StoryPriorityEvaluation["status"],
    ): boolean {
        const validTransitions: Record<StoryPriorityEvaluation["status"], StoryPriorityEvaluation["status"][]> = {
            pending: ["in_progress", "failed"],
            in_progress: ["completed", "failed"],
            completed: ["approved", "rejected"],
            failed: ["pending"],
            approved: [],
            rejected: ["pending"],
        };

        return validTransitions[from].includes(to);
    },
};

export const StoryPrioritizationFactory = {
    createPriorityScore(
        storyId: string,
        criteria: PriorityCriterion[],
        calculatedBy: string,
    ): Result<PriorityScore> {
        const validation = StoryPrioritizationDomainRules.validateCriteria(criteria, {
            minCriteria: 3,
            maxCriteria: 6,
            minWeight: 0.05,
            maxWeight: 0.5,
            weightSumTolerance: 0.01,
        });

        if (!validation.success) {
            return { success: false, error: validation.error };
        }

        const weightedScore = StoryPrioritizationDomainRules.calculateWeightedScore(criteria);
        const totalScore = Math.min(10, Math.max(0, weightedScore));
        const priority = StoryPrioritizationDomainRules.determinePriorityFromScore(totalScore);
        const confidence = StoryPrioritizationDomainRules.calculateConfidence(criteria);

        const score: PriorityScore = {
            storyId,
            totalScore,
            weightedScore,
            priority,
            confidence,
            criteria,
            calculatedAt: new Date(),
            calculatedBy,
            version: 1,
        };

        return { success: true, data: score };
    },

    createPriorityEvaluation(
        storyId: string,
        requestedBy: string,
    ): StoryPriorityEvaluation {
        return {
            id: `eval-${Date.now()}-${storyId}`,
            storyId,
            status: "pending",
            requestedBy,
            requestedAt: new Date(),
        };
    },

    createPriorityHistoryEntry(
        storyId: string,
        previousPriority: "low" | "medium" | "high" | undefined,
        newPriority: "low" | "medium" | "high",
        previousScore: number | undefined,
        newScore: number,
        changedBy: string,
        reason: string,
        evaluationId?: string,
    ): PriorityHistoryEntry {
        return {
            id: `hist-${Date.now()}-${storyId}`,
            storyId,
            previousPriority,
            newPriority,
            previousScore,
            newScore,
            changedBy,
            changedAt: new Date(),
            reason,
            evaluationId,
        };
    },
};
