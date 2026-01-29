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
    { id: "new-feature-proposed", group: "research" },
    { id: "features-prioritized", group: "research" },
    { id: "stories-created", group: "ux" },
    { id: "stories-prioritized", group: "planning" },
    { id: "tasks-prepared", group: "refinement" },
    { id: "task-in-progress", group: "dev" },
    { id: "tests-completed", group: "testing" },
    { id: "task-completed", group: "done" },
];

export const workflowLinks: WorkflowGraphLink[] = [
    {
        source: "new-feature-proposed",
        target: "new-feature-proposed",
        label: "retry-product-research",
    },
    { source: "new-feature-proposed", target: "features-prioritized", label: "prioritize-features" },
    { source: "features-prioritized", target: "stories-created", label: "do-ux-research" },
    { source: "features-prioritized", target: "stories-prioritized", label: "prioritize-stories" },
    { source: "stories-created", target: "stories-prioritized", label: "prioritize-stories" },
    { source: "stories-created", target: "new-feature-proposed", label: "request-feature" },
    { source: "stories-prioritized", target: "tasks-prepared", label: "refine-into-tasks" },
    { source: "tasks-prepared", target: "task-in-progress", label: "begin-implementation" },
    { source: "tasks-prepared", target: "task-completed", label: "close-invalid-task" },
    { source: "tasks-prepared", target: "stories-prioritized", label: "need-more-tasks" },
    { source: "task-in-progress", target: "tests-completed", label: "run-tests" },
    { source: "task-in-progress", target: "task-in-progress", label: "additional-implementation" },
    { source: "task-in-progress", target: "tasks-prepared", label: "refine-task" },
    { source: "tests-completed", target: "task-completed", label: "tests-passing" },
    { source: "tests-completed", target: "task-in-progress", label: "tests-failed" },
    { source: "task-completed", target: "tasks-prepared", label: "pick-up-next-task" },
    { source: "task-completed", target: "new-feature-proposed", label: "research-new-features" },
    { source: "task-completed", target: "features-prioritized", label: "prioritize-features" },
    { source: "task-completed", target: "stories-prioritized", label: "prioritize-stories" },
];

export const workflowGraph: WorkflowGraph = {
    nodes: workflowNodes,
    links: workflowLinks,
};
