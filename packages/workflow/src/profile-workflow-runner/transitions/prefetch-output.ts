import type { WorkflowTask } from "../../agent-runner.ts";
import { summarizeTaskList } from "../shared/task-context.ts";
import { isActiveStatus, normalizeTaskType } from "../shared/task-normalization.ts";

type PrefetchFilter = {
    type?: string;
    status?: string[];
};

const PREFETCH_FILTERS_BY_TRANSITION: Record<string, PrefetchFilter | null> = {
    "prioritize-features": { type: "feature", status: ["todo", "in-progress"] },
    "prioritize-themes": { type: "theme", status: ["todo", "in-progress"] },
    "prioritize-initiatives": { type: "initiative", status: ["todo", "in-progress"] },
    "prioritize-stories": { type: "story", status: ["todo", "in-progress"] },
    "refine-into-tasks": null,
    "need-more-tasks": null,
};

const baseOutput = (tasks: WorkflowTask[]): string => {
    const { lines, truncated } = summarizeTaskList(tasks, 25);
    const header = `Found ${tasks.length} tasks${truncated ? ` (showing first ${lines.length})` : ""}:`;
    const truncationNote =
        truncated ? "Note: list truncated; call list_tasks for the full set if needed." : "";
    return [header, ...lines, truncationNote].filter((line) => line.length > 0).join("\n");
};

const applyPrefetchFilter = (tasks: WorkflowTask[], filter: PrefetchFilter | null): WorkflowTask[] => {
    if (!filter) {
        return tasks;
    }

    return tasks.filter((task) => {
        const typeMatch =
            !filter.type || normalizeTaskType(task.type) === filter.type;
        const statusMatch = !filter.status || isActiveStatus(task.status);
        return typeMatch && statusMatch;
    });
};

export const buildPrefetchedListTasksOutput = (
    transition: string,
    tasks: WorkflowTask[],
): string | null => {
    const normalizedTransition = transition.trim().toLowerCase();
    if (!(normalizedTransition in PREFETCH_FILTERS_BY_TRANSITION)) {
        return null;
    }

    const filter = PREFETCH_FILTERS_BY_TRANSITION[normalizedTransition] ?? null;
    const filtered = applyPrefetchFilter(tasks, filter);
    if (!filter) {
        return `Prefetched list_tasks output (no filters):\n${baseOutput(filtered)}`;
    }

    return `Prefetched list_tasks output (filters ${JSON.stringify(filter)}):\n${baseOutput(filtered)}`;
};
