import { type Atom } from "jotai";
export * from "./atoms/themeAtoms.ts";
export declare const refreshAtom: import("jotai").PrimitiveAtom<number> & {
    init: number;
};
export declare const searchQueryAtom: import("jotai").PrimitiveAtom<string> & {
    init: string;
};
export declare const taskFiltersAtom: import("jotai").PrimitiveAtom<{
    status?: ("todo" | "in-progress" | "done" | "invalid")[];
    priority?: ("low" | "medium" | "high")[];
    createdBy?: string[];
    assignedTo?: string[];
    collaborators?: string[];
    watchers?: string[];
    dateFrom?: string;
    dateTo?: string;
}> & {
    init: {
        status?: ("todo" | "in-progress" | "done" | "invalid")[];
        priority?: ("low" | "medium" | "high")[];
        createdBy?: string[];
        assignedTo?: string[];
        collaborators?: string[];
        watchers?: string[];
        dateFrom?: string;
        dateTo?: string;
    };
};
export declare const taskSortAtom: import("jotai").PrimitiveAtom<{
    field?: "status" | "updatedAt" | "createdAt" | "title" | "priority";
    direction?: "asc" | "desc";
}> & {
    init: {
        field?: "status" | "updatedAt" | "createdAt" | "title" | "priority";
        direction?: "asc" | "desc";
    };
};
export declare const filteredTasksAtom: Atom<Promise<import("zod").objectOutputType<{
    id: import("zod").ZodString;
    createdAt: import("zod").ZodDate;
    updatedAt: import("zod").ZodDate;
} & {
    title: import("zod").ZodString;
    description: import("zod").ZodString;
    status: import("zod").ZodEnum<["todo", "in-progress", "done", "invalid"]>;
    priority: import("zod").ZodEnum<["low", "medium", "high"]>;
    type: import("zod").ZodEnum<["theme", "initiative", "feature", "story", "task", "implementation", "integration", "testing", "research"]>;
    branch: import("zod").ZodOptional<import("zod").ZodString>;
    dependencies: import("zod").ZodArray<import("zod").ZodString, "many">;
    createdBy: import("zod").ZodString;
    assignedTo: import("zod").ZodOptional<import("zod").ZodString>;
    collaborators: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
    watchers: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
    actionLog: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, "passthrough", import("zod").ZodTypeAny, import("zod").objectOutputType<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, import("zod").ZodTypeAny, "passthrough">, import("zod").objectInputType<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, import("zod").ZodTypeAny, "passthrough">>, "many">>;
}, import("zod").ZodTypeAny, "passthrough">[]>>;
export declare const tasksAtom: Atom<any[] | Promise<import("zod").objectOutputType<{
    id: import("zod").ZodString;
    createdAt: import("zod").ZodDate;
    updatedAt: import("zod").ZodDate;
} & {
    title: import("zod").ZodString;
    description: import("zod").ZodString;
    status: import("zod").ZodEnum<["todo", "in-progress", "done", "invalid"]>;
    priority: import("zod").ZodEnum<["low", "medium", "high"]>;
    type: import("zod").ZodEnum<["theme", "initiative", "feature", "story", "task", "implementation", "integration", "testing", "research"]>;
    branch: import("zod").ZodOptional<import("zod").ZodString>;
    dependencies: import("zod").ZodArray<import("zod").ZodString, "many">;
    createdBy: import("zod").ZodString;
    assignedTo: import("zod").ZodOptional<import("zod").ZodString>;
    collaborators: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
    watchers: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
    actionLog: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, "passthrough", import("zod").ZodTypeAny, import("zod").objectOutputType<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, import("zod").ZodTypeAny, "passthrough">, import("zod").objectInputType<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, import("zod").ZodTypeAny, "passthrough">>, "many">>;
}, import("zod").ZodTypeAny, "passthrough">[]>>;
export declare const queueAtom: Atom<any[] | Promise<import("zod").objectOutputType<{
    id: import("zod").ZodString;
    createdAt: import("zod").ZodDate;
    updatedAt: import("zod").ZodDate;
} & {
    title: import("zod").ZodString;
    description: import("zod").ZodString;
    status: import("zod").ZodEnum<["todo", "in-progress", "done", "invalid"]>;
    priority: import("zod").ZodEnum<["low", "medium", "high"]>;
    type: import("zod").ZodEnum<["theme", "initiative", "feature", "story", "task", "implementation", "integration", "testing", "research"]>;
    branch: import("zod").ZodOptional<import("zod").ZodString>;
    dependencies: import("zod").ZodArray<import("zod").ZodString, "many">;
    createdBy: import("zod").ZodString;
    assignedTo: import("zod").ZodOptional<import("zod").ZodString>;
    collaborators: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
    watchers: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
    actionLog: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, "passthrough", import("zod").ZodTypeAny, import("zod").objectOutputType<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, import("zod").ZodTypeAny, "passthrough">, import("zod").objectInputType<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, import("zod").ZodTypeAny, "passthrough">>, "many">>;
}, import("zod").ZodTypeAny, "passthrough">[]>>;
export declare const tasksLoadableAtom: Atom<import("jotai/vanilla/utils/loadable").Loadable<Promise<import("zod").objectOutputType<{
    id: import("zod").ZodString;
    createdAt: import("zod").ZodDate;
    updatedAt: import("zod").ZodDate;
} & {
    title: import("zod").ZodString;
    description: import("zod").ZodString;
    status: import("zod").ZodEnum<["todo", "in-progress", "done", "invalid"]>;
    priority: import("zod").ZodEnum<["low", "medium", "high"]>;
    type: import("zod").ZodEnum<["theme", "initiative", "feature", "story", "task", "implementation", "integration", "testing", "research"]>;
    branch: import("zod").ZodOptional<import("zod").ZodString>;
    dependencies: import("zod").ZodArray<import("zod").ZodString, "many">;
    createdBy: import("zod").ZodString;
    assignedTo: import("zod").ZodOptional<import("zod").ZodString>;
    collaborators: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
    watchers: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
    actionLog: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, "passthrough", import("zod").ZodTypeAny, import("zod").objectOutputType<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, import("zod").ZodTypeAny, "passthrough">, import("zod").objectInputType<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, import("zod").ZodTypeAny, "passthrough">>, "many">>;
}, import("zod").ZodTypeAny, "passthrough">[]>>>;
export declare const queueLoadableAtom: Atom<import("jotai/vanilla/utils/loadable").Loadable<Promise<import("zod").objectOutputType<{
    id: import("zod").ZodString;
    createdAt: import("zod").ZodDate;
    updatedAt: import("zod").ZodDate;
} & {
    title: import("zod").ZodString;
    description: import("zod").ZodString;
    status: import("zod").ZodEnum<["todo", "in-progress", "done", "invalid"]>;
    priority: import("zod").ZodEnum<["low", "medium", "high"]>;
    type: import("zod").ZodEnum<["theme", "initiative", "feature", "story", "task", "implementation", "integration", "testing", "research"]>;
    branch: import("zod").ZodOptional<import("zod").ZodString>;
    dependencies: import("zod").ZodArray<import("zod").ZodString, "many">;
    createdBy: import("zod").ZodString;
    assignedTo: import("zod").ZodOptional<import("zod").ZodString>;
    collaborators: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
    watchers: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
    actionLog: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, "passthrough", import("zod").ZodTypeAny, import("zod").objectOutputType<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, import("zod").ZodTypeAny, "passthrough">, import("zod").objectInputType<{
        id: import("zod").ZodString;
        summary: import("zod").ZodString;
        profile: import("zod").ZodString;
        durationMs: import("zod").ZodNumber;
        createdAt: import("zod").ZodDate;
        success: import("zod").ZodBoolean;
        transition: import("zod").ZodOptional<import("zod").ZodString>;
        prompt: import("zod").ZodOptional<import("zod").ZodString>;
        modelName: import("zod").ZodOptional<import("zod").ZodString>;
    }, import("zod").ZodTypeAny, "passthrough">>, "many">>;
}, import("zod").ZodTypeAny, "passthrough">[]>>>;
export declare const lastEventAtom: Atom<{
    type?: "task_created" | "task_updated" | "task_deleted" | "task_assigned" | "task_status_changed" | "task_priority_changed" | "task_collaborators_updated" | "task_watchers_updated" | "tasks_list" | "task_archived" | "task_restored" | "retention_policy_executed" | "pong";
    data?: unknown;
    timestamp?: Date;
}>;
