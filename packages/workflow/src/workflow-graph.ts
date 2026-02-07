import type { WorkflowStateName } from "./workflow-factory.ts";

export type WorkflowGraphNode = {
    id: WorkflowStateName;
    group: string;
};

export type WorkflowGraphLink = {
    source: WorkflowStateName;
    target: WorkflowStateName;
    label: string;
};

export type WorkflowGraph = {
    nodes: WorkflowGraphNode[];
    links: WorkflowGraphLink[];
};

export const workflowNodes: WorkflowGraphNode[] = [
    { id: "themes-proposed", group: "portfolio" },
    { id: "themes-prioritized", group: "portfolio" },
    { id: "initiatives-proposed", group: "portfolio" },
    { id: "initiatives-prioritized", group: "portfolio" },
    { id: "new-feature-proposed", group: "research" },
    { id: "features-prioritized", group: "research" },
    { id: "stories-created", group: "ux" },
    { id: "stories-prioritized", group: "planning" },
    { id: "tasks-prepared", group: "refinement" },
    { id: "task-in-progress", group: "dev" },
    { id: "lint-completed", group: "testing" },
    { id: "typecheck-completed", group: "testing" },
    { id: "unit-tests-completed", group: "testing" },
    { id: "e2e-tests-completed", group: "testing" },
    { id: "coverage-completed", group: "testing" },
    { id: "task-completed", group: "done" },
];

export const workflowLinks: WorkflowGraphLink[] = [
    { source: "themes-proposed", target: "themes-proposed", label: "retry-theme-research" },
    { source: "themes-proposed", target: "themes-prioritized", label: "prioritize-themes" },
    { source: "themes-prioritized", target: "themes-proposed", label: "request-theme" },
    { source: "themes-prioritized", target: "initiatives-proposed", label: "define-initiatives" },
    { source: "themes-prioritized", target: "initiatives-prioritized", label: "prioritize-initiatives" },
    { source: "initiatives-proposed", target: "initiatives-proposed", label: "retry-initiative-research" },
    { source: "initiatives-proposed", target: "initiatives-prioritized", label: "prioritize-initiatives" },
    { source: "initiatives-proposed", target: "themes-proposed", label: "request-theme" },
    { source: "initiatives-prioritized", target: "initiatives-proposed", label: "define-initiatives" },
    { source: "initiatives-prioritized", target: "new-feature-proposed", label: "research-new-features" },
    { source: "initiatives-prioritized", target: "features-prioritized", label: "prioritize-features" },
    {
        source: "new-feature-proposed",
        target: "new-feature-proposed",
        label: "retry-product-research",
    },
    { source: "new-feature-proposed", target: "initiatives-proposed", label: "define-initiatives" },
    { source: "new-feature-proposed", target: "features-prioritized", label: "prioritize-features" },
    { source: "features-prioritized", target: "stories-created", label: "do-ux-research" },
    { source: "features-prioritized", target: "stories-prioritized", label: "prioritize-stories" },
    { source: "stories-created", target: "stories-prioritized", label: "prioritize-stories" },
    { source: "stories-created", target: "new-feature-proposed", label: "request-feature" },
    { source: "stories-prioritized", target: "tasks-prepared", label: "refine-into-tasks" },
    { source: "tasks-prepared", target: "task-in-progress", label: "begin-implementation" },
    { source: "tasks-prepared", target: "task-completed", label: "close-invalid-task" },
    { source: "tasks-prepared", target: "stories-prioritized", label: "need-more-tasks" },
    { source: "task-in-progress", target: "lint-completed", label: "run-lint" },
    { source: "task-in-progress", target: "tasks-prepared", label: "refine-task" },
    { source: "lint-completed", target: "typecheck-completed", label: "run-typecheck" },
    { source: "lint-completed", target: "task-in-progress", label: "lint-failed" },
    { source: "typecheck-completed", target: "unit-tests-completed", label: "run-unit-tests" },
    { source: "typecheck-completed", target: "task-in-progress", label: "typecheck-failed" },
    { source: "unit-tests-completed", target: "e2e-tests-completed", label: "run-e2e-tests" },
    { source: "unit-tests-completed", target: "task-in-progress", label: "unit-tests-failed" },
    { source: "e2e-tests-completed", target: "coverage-completed", label: "ensure-coverage" },
    { source: "e2e-tests-completed", target: "task-in-progress", label: "e2e-tests-failed" },
    { source: "coverage-completed", target: "task-completed", label: "tests-passing" },
    { source: "coverage-completed", target: "task-in-progress", label: "coverage-failed" },
    { source: "task-completed", target: "tasks-prepared", label: "pick-up-next-task" },
    { source: "task-completed", target: "themes-proposed", label: "research-new-themes" },
    { source: "task-completed", target: "themes-prioritized", label: "prioritize-themes" },
    { source: "task-completed", target: "initiatives-prioritized", label: "prioritize-initiatives" },
    { source: "task-completed", target: "features-prioritized", label: "prioritize-features" },
    { source: "task-completed", target: "stories-prioritized", label: "prioritize-stories" },
];

export const workflowGraph: WorkflowGraph = {
    nodes: workflowNodes,
    links: workflowLinks,
};
