import type { Self } from "@tsimpl/core";
import { method, trait } from "@tsimpl/runtime";
import type { SupervisionProcessKind, SupervisionProcessSnapshot } from "./domain.ts";

export const SupervisableTrait = trait("SupervisableTrait", {
    id: method<Self, string>(),
    kind: method<Self, SupervisionProcessKind>(),
    start: method<Self, Promise<SupervisionProcessSnapshot>>({ abstract: true }),
    stop: method<Self, Promise<SupervisionProcessSnapshot>, [signal?: NodeJS.Signals]>({
        abstract: true,
    }),
    restart: method<Self, Promise<SupervisionProcessSnapshot>>({ abstract: true }),
    snapshot: method<Self, Promise<SupervisionProcessSnapshot>>({ abstract: true }),
});

export const SupervisorTrait = trait("SupervisorTrait", {
    listProcesses: method<Self, Promise<readonly SupervisionProcessSnapshot[]>>({
        abstract: true,
    }),
    startProcess: method<Self, Promise<SupervisionProcessSnapshot | null>, [targetId: string]>({
        abstract: true,
    }),
    stopProcess: method<
        Self,
        Promise<SupervisionProcessSnapshot | null>,
        [targetId: string, signal?: NodeJS.Signals]
    >({
        abstract: true,
    }),
    restartProcess: method<Self, Promise<SupervisionProcessSnapshot | null>, [targetId: string]>({
        abstract: true,
    }),
    reconcileProcesses: method<
        Self,
        Promise<readonly SupervisionProcessSnapshot[]>,
        [desiredCount: number]
    >({
        default: async () => [],
    }),
});
