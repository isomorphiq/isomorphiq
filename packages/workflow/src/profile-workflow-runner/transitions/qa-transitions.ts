export type QaRunTransition =
    | "run-lint"
    | "run-typecheck"
    | "run-unit-tests"
    | "run-e2e-tests"
    | "ensure-coverage";

export type ProceduralQaTransition =
    | "run-lint"
    | "run-typecheck"
    | "run-unit-tests"
    | "run-e2e-tests"
    | "ensure-coverage";

export const QA_RUN_TRANSITIONS: QaRunTransition[] = [
    "run-lint",
    "run-typecheck",
    "run-unit-tests",
    "run-e2e-tests",
    "ensure-coverage",
];

const PROCEDURAL_QA_TRANSITIONS: ProceduralQaTransition[] = [
    "run-lint",
    "run-typecheck",
    "run-unit-tests",
    "run-e2e-tests",
    "ensure-coverage",
];

export const QA_FAIL_TRANSITIONS = [
    "lint-failed",
    "typecheck-failed",
    "unit-tests-failed",
    "e2e-tests-failed",
    "coverage-failed",
] as const;

export const QA_TRACKED_TRANSITIONS = [
    "begin-implementation",
    ...QA_RUN_TRANSITIONS,
    ...QA_FAIL_TRANSITIONS,
    "tests-passing",
] as const;

export const isProceduralQaTransition = (
    transition: string,
): transition is ProceduralQaTransition =>
    PROCEDURAL_QA_TRANSITIONS.includes(transition as ProceduralQaTransition);

export const shouldRunQaPreflightForTransition = (
    transition: string,
): transition is QaRunTransition =>
    QA_RUN_TRANSITIONS.includes(transition as QaRunTransition);

export const isQaRunTransition = (transition: string): transition is QaRunTransition =>
    QA_RUN_TRANSITIONS.includes(transition as QaRunTransition);

export const isQaFailureTransition = (transition: string): boolean =>
    QA_FAIL_TRANSITIONS.includes(transition as (typeof QA_FAIL_TRANSITIONS)[number]);
