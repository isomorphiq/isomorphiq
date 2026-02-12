import type { WorkflowTask } from "./workflow-factory.ts";

const INCOMPLETE_TEXT_PATTERNS: ReadonlyArray<RegExp> = [
    /\b(tbd|todo|fixme|n\/a|na|unknown|missing info|needs info|need more info|to be defined|to be decided|placeholder|fill in)\b/i,
    /\?{2,}/,
    /{{[^}]+}}/,
];

const normalize = (value: string | undefined): string => (value ?? "").trim();

const hasIncompleteMarker = (text: string): boolean =>
    INCOMPLETE_TEXT_PATTERNS.some((pattern) => pattern.test(text));

export const isWorkflowTaskTextComplete = (task: WorkflowTask): boolean => {
    const title = normalize(task.title);
    const description = normalize(task.description);
    if (title.length < 3) {
        return false;
    }
    if (description.length === 0) {
        return false;
    }
    return !hasIncompleteMarker(`${title} ${description}`);
};

export const isWorkflowTaskActionable = (task: WorkflowTask): boolean => {
    if (task.status !== "todo") {
        return false;
    }
    return isWorkflowTaskTextComplete(task);
};
