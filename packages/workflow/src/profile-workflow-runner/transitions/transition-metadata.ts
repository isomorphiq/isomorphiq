import type { RuntimeState } from "../../workflow-factory.ts";

const TRANSITION_TARGET_TYPE_OVERRIDES: Record<string, string> = {
    "retry-theme-research": "theme",
    "research-new-themes": "theme",
    "prioritize-themes": "theme",
    "define-initiatives": "theme",
    "retry-initiative-research": "theme",
    "prioritize-initiatives": "initiative",
    "retry-product-research": "initiative",
    "research-new-features": "initiative",
    "prioritize-features": "feature",
    "do-ux-research": "feature",
    "prioritize-stories": "story",
    "refine-into-tasks": "story",
    "need-more-tasks": "story",
    "begin-implementation": "implementation",
    "run-lint": "testing",
    "run-typecheck": "testing",
    "run-unit-tests": "testing",
    "run-e2e-tests": "testing",
    "ensure-coverage": "testing",
    "tests-passing": "testing",
    "lint-failed": "implementation",
    "typecheck-failed": "implementation",
    "unit-tests-failed": "implementation",
    "e2e-tests-failed": "implementation",
    "coverage-failed": "implementation",
};

const TRANSITION_PROFILE_OVERRIDES: Record<string, string> = {
    "retry-theme-research": "portfolio-manager",
    "research-new-themes": "portfolio-manager",
    "prioritize-themes": "portfolio-prioritization-lead",
    "define-initiatives": "portfolio-manager",
    "retry-initiative-research": "portfolio-manager",
    "prioritize-initiatives": "portfolio-prioritization-lead",
    "request-theme": "portfolio-manager",
    "retry-product-research": "product-manager",
    "research-new-features": "product-manager",
    "prioritize-features": "product-prioritization-lead",
    "do-ux-research": "ux-specialist",
    "prioritize-stories": "story-prioritization-lead",
    "request-feature": "ux-specialist",
    "refine-into-tasks": "refinement",
    "need-more-tasks": "principal-architect",
    "close-invalid-task": "project-manager",
    "refine-task": "refinement",
    "begin-implementation": "senior-developer",
    "run-lint": "qa-specialist",
    "run-typecheck": "qa-specialist",
    "run-unit-tests": "qa-specialist",
    "run-e2e-tests": "qa-specialist",
    "ensure-coverage": "qa-specialist",
    "tests-passing": "qa-specialist",
    "lint-failed": "senior-developer",
    "typecheck-failed": "senior-developer",
    "unit-tests-failed": "senior-developer",
    "e2e-tests-failed": "senior-developer",
    "coverage-failed": "senior-developer",
    "pick-up-next-task": "development",
};

const TRANSITIONS_ALLOWED_WITHOUT_TASK = new Set([
    "retry-theme-research",
    "research-new-themes",
    "request-theme",
    "prioritize-themes",
    "retry-product-research",
    "research-new-features",
    "run-lint",
    "run-typecheck",
    "run-unit-tests",
    "run-e2e-tests",
    "ensure-coverage",
    "tests-passing",
]);

const FALLBACK_TRANSITIONS_BY_TRANSITION: Record<string, string[]> = {
    "prioritize-themes": ["request-theme", "retry-theme-research", "research-new-themes"],
    "prioritize-initiatives": ["define-initiatives", "request-theme"],
    "define-initiatives": [
        "request-theme",
        "retry-theme-research",
        "research-new-themes",
        "research-new-features",
    ],
    "prioritize-features": ["research-new-features", "define-initiatives", "request-theme"],
    "prioritize-stories": ["do-ux-research", "request-feature", "prioritize-features"],
};

const TRANSITIONS_NEEDING_CONTEXT = new Set([
    "define-initiatives",
    "retry-initiative-research",
    "retry-product-research",
    "research-new-features",
    "do-ux-research",
    "refine-into-tasks",
    "need-more-tasks",
    "begin-implementation",
    "close-invalid-task",
    "run-lint",
    "run-typecheck",
    "run-unit-tests",
    "run-e2e-tests",
    "ensure-coverage",
    "lint-failed",
    "typecheck-failed",
    "unit-tests-failed",
    "e2e-tests-failed",
    "coverage-failed",
    "tests-passing",
]);

const TRANSITIONS_NEEDING_DESCRIPTION = new Set([
    "define-initiatives",
    "retry-initiative-research",
    "retry-product-research",
    "research-new-features",
    "do-ux-research",
    "refine-into-tasks",
    "need-more-tasks",
    "begin-implementation",
    "close-invalid-task",
    "run-lint",
    "run-typecheck",
    "run-unit-tests",
    "run-e2e-tests",
    "ensure-coverage",
    "lint-failed",
    "typecheck-failed",
    "unit-tests-failed",
    "e2e-tests-failed",
    "coverage-failed",
    "tests-passing",
]);

export const resolveTargetTypeForTransition = (
    state: RuntimeState,
    transition: string,
): string | undefined => TRANSITION_TARGET_TYPE_OVERRIDES[transition] ?? state.targetType;

export const canRunWithoutTask = (transition: string): boolean =>
    TRANSITIONS_ALLOWED_WITHOUT_TASK.has(transition);

export const resolveNoTaskFallbackTransition = (
    state: RuntimeState,
    transition: string,
): string | null => {
    const candidates = FALLBACK_TRANSITIONS_BY_TRANSITION[transition] ?? [];
    const next = candidates.find((candidate) => Boolean(state.transitions[candidate]));
    return next ?? null;
};

export const shouldIncludeTaskContextForTransition = (transition: string): boolean =>
    TRANSITIONS_NEEDING_CONTEXT.has(transition);

export const shouldIncludeTaskDescriptionForTransition = (transition: string): boolean =>
    TRANSITIONS_NEEDING_DESCRIPTION.has(transition);

export const resolveProfileForTransition = (state: RuntimeState, transition: string): string =>
    TRANSITION_PROFILE_OVERRIDES[transition] ?? state.profile;
