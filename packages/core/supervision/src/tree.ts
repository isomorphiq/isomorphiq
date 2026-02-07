import { impl, method } from "@tsimpl/runtime";
import {
    SupervisionProcessSnapshotSchema,
    type SupervisionProcessSnapshot,
    type SupervisionProcessStatus,
} from "./domain.ts";
import { SupervisableTrait, SupervisorTrait } from "./traits.ts";

type SupervisorLifecycleHooks = {
    start?: () => Promise<void>;
    stop?: (signal?: NodeJS.Signals) => Promise<void>;
    restart?: () => Promise<void>;
    snapshot?: () => Promise<Partial<SupervisionProcessSnapshot>>;
};

export type DelegatingSupervisorOptions = {
    id: string;
    name: string;
    lifecycle?: SupervisorLifecycleHooks;
};

export type DelegatingSupervisor = {
    registerSupervisable: (supervisable: object) => void;
    unregisterSupervisable: (supervisableId: string) => void;
    hasSupervisable: (supervisableId: string) => boolean;
    listSupervisableIds: () => readonly string[];
};

const nowIso = (): string => new Date().toISOString();

const toSnapshot = (
    value: SupervisionProcessSnapshot | Record<string, unknown>,
): SupervisionProcessSnapshot =>
    SupervisionProcessSnapshotSchema.parse(value) as SupervisionProcessSnapshot;

const supervisableId = (candidate: object): string =>
    SupervisableTrait.id(candidate as any);

const supervisableKind = (candidate: object): string =>
    SupervisableTrait.kind(candidate as any);

const supervisableSnapshot = async (candidate: object): Promise<SupervisionProcessSnapshot> =>
    await SupervisableTrait.snapshot(candidate as any);

const supervisableStart = async (candidate: object): Promise<SupervisionProcessSnapshot> =>
    await SupervisableTrait.start(candidate as any);

const supervisableStop = async (
    candidate: object,
    signal?: NodeJS.Signals,
): Promise<SupervisionProcessSnapshot> =>
    await SupervisableTrait.stop(candidate as any, signal);

const supervisableRestart = async (candidate: object): Promise<SupervisionProcessSnapshot> =>
    await SupervisableTrait.restart(candidate as any);

const supervisorList = async (candidate: object): Promise<readonly SupervisionProcessSnapshot[]> =>
    await SupervisorTrait.listProcesses(candidate as any);

const supervisorStartProcess = async (
    candidate: object,
    targetId: string,
): Promise<SupervisionProcessSnapshot | null> =>
    await SupervisorTrait.startProcess(candidate as any, targetId);

const supervisorStopProcess = async (
    candidate: object,
    targetId: string,
    signal?: NodeJS.Signals,
): Promise<SupervisionProcessSnapshot | null> =>
    await SupervisorTrait.stopProcess(candidate as any, targetId, signal);

const supervisorRestartProcess = async (
    candidate: object,
    targetId: string,
): Promise<SupervisionProcessSnapshot | null> =>
    await SupervisorTrait.restartProcess(candidate as any, targetId);

const supervisorReconcileProcesses = async (
    candidate: object,
    desiredCount: number,
): Promise<readonly SupervisionProcessSnapshot[]> =>
    await SupervisorTrait.reconcileProcesses(candidate as any, desiredCount);

const isSupervisor = (candidate: object): boolean => {
    try {
        return supervisableKind(candidate) === "supervisor";
    } catch {
        return false;
    }
};

const asSupervisorChildren = (children: readonly object[]): readonly object[] =>
    children.filter((child) => isSupervisor(child));

const callSupervisorOperation = async <T>(
    supervisor: object,
    operation: (target: object) => Promise<T>,
): Promise<T | null> => {
    try {
        return await operation(supervisor);
    } catch {
        return null;
    }
};

const flattenSnapshots = (
    groups: readonly (readonly SupervisionProcessSnapshot[])[],
): readonly SupervisionProcessSnapshot[] =>
    groups.reduce<SupervisionProcessSnapshot[]>(
        (acc, group) => [...acc, ...group],
        [],
    );

export const createDelegatingSupervisor = (
    options: DelegatingSupervisorOptions,
): DelegatingSupervisor => {
    const children = new Map<string, object>();
    let status: SupervisionProcessStatus = "stopped";
    let startedAt: string | undefined;

    const readChildren = (): readonly object[] => Array.from(children.values());
    const readDirectChild = (targetId: string): object | null => children.get(targetId) ?? null;

    const supervisor = {
        registerSupervisable: (supervisable: object): void => {
            children.set(supervisableId(supervisable), supervisable);
        },
        unregisterSupervisable: (supervisableId: string): void => {
            children.delete(supervisableId);
        },
        hasSupervisable: (supervisableId: string): boolean => children.has(supervisableId),
        listSupervisableIds: (): readonly string[] => Array.from(children.keys()),
    };

    const readSnapshot = async (): Promise<SupervisionProcessSnapshot> => {
        const partial = (await options.lifecycle?.snapshot?.()) ?? {};
        const nextStatus = partial.status ?? status;
        const nextStartedAt = partial.startedAt ?? startedAt;
        return toSnapshot({
            id: options.id,
            name: options.name,
            kind: "supervisor",
            status: nextStatus,
            pid: partial.pid,
            managedBy: partial.managedBy,
            startedAt: nextStartedAt,
            updatedAt: nowIso(),
            metadata: partial.metadata,
        });
    };

    impl(SupervisableTrait).for(supervisor, {
        id: method(() => options.id),
        kind: method(() => "supervisor"),
        start: method(async () => {
            status = "starting";
            await options.lifecycle?.start?.();
            status = "running";
            startedAt = startedAt ?? nowIso();
            return await readSnapshot();
        }),
        stop: method(async (_self: unknown, signal?: NodeJS.Signals) => {
            status = "stopping";
            await options.lifecycle?.stop?.(signal);
            status = "stopped";
            return await readSnapshot();
        }),
        restart: method(async () => {
            if (options.lifecycle?.restart) {
                status = "starting";
                await options.lifecycle.restart();
                status = "running";
            } else {
                status = "stopping";
                await options.lifecycle?.stop?.("SIGTERM");
                status = "starting";
                await options.lifecycle?.start?.();
                status = "running";
            }
            startedAt = startedAt ?? nowIso();
            return await readSnapshot();
        }),
        snapshot: method(async () => await readSnapshot()),
    });

    impl(SupervisorTrait).for(supervisor, {
        listProcesses: method(async () => {
            const directChildren = readChildren();
            const directSnapshots = await Promise.all(
                directChildren.map((child) => supervisableSnapshot(child)),
            );
            const delegatedSnapshots = await Promise.all(
                asSupervisorChildren(directChildren).map(async (childSupervisor) => {
                    const delegated =
                        await callSupervisorOperation(childSupervisor, async (target) =>
                            await supervisorList(target),
                        );
                    return delegated ?? [];
                }),
            );
            return [
                ...directSnapshots,
                ...flattenSnapshots(delegatedSnapshots),
            ];
        }),
        startProcess: method(async (_self: unknown, targetId: string) => {
            const direct = readDirectChild(targetId);
            if (direct) {
                return await supervisableStart(direct);
            }
            for (const childSupervisor of asSupervisorChildren(readChildren())) {
                const delegated = await callSupervisorOperation(
                    childSupervisor,
                    async (target) => await supervisorStartProcess(target, targetId),
                );
                if (delegated) {
                    return delegated;
                }
            }
            return null;
        }),
        stopProcess: method(
            async (_self: unknown, targetId: string, signal?: NodeJS.Signals) => {
                const direct = readDirectChild(targetId);
                if (direct) {
                    return await supervisableStop(direct, signal);
                }
                for (const childSupervisor of asSupervisorChildren(readChildren())) {
                    const delegated = await callSupervisorOperation(
                        childSupervisor,
                        async (target) =>
                            await supervisorStopProcess(target, targetId, signal),
                    );
                    if (delegated) {
                        return delegated;
                    }
                }
                return null;
            },
        ),
        restartProcess: method(async (_self: unknown, targetId: string) => {
            const direct = readDirectChild(targetId);
            if (direct) {
                return await supervisableRestart(direct);
            }
            for (const childSupervisor of asSupervisorChildren(readChildren())) {
                const delegated = await callSupervisorOperation(
                    childSupervisor,
                    async (target) => await supervisorRestartProcess(target, targetId),
                );
                if (delegated) {
                    return delegated;
                }
            }
            return null;
        }),
        reconcileProcesses: method(async (_self: unknown, desiredCount: number) => {
            const reconciliation = await Promise.all(
                asSupervisorChildren(readChildren()).map(async (childSupervisor) => {
                    const delegated = await callSupervisorOperation(
                        childSupervisor,
                        async (target) =>
                            await supervisorReconcileProcesses(target, desiredCount),
                    );
                    return delegated ?? [];
                }),
            );
            return flattenSnapshots(reconciliation);
        }),
    });

    return supervisor;
};

export const listSupervisorTree = async (
    supervisor: object,
): Promise<readonly SupervisionProcessSnapshot[]> =>
    await supervisorList(supervisor);

export const startInSupervisorTree = async (
    supervisor: object,
    targetId: string,
): Promise<SupervisionProcessSnapshot | null> =>
    await supervisorStartProcess(supervisor, targetId);

export const stopInSupervisorTree = async (
    supervisor: object,
    targetId: string,
    signal?: NodeJS.Signals,
): Promise<SupervisionProcessSnapshot | null> =>
    await supervisorStopProcess(supervisor, targetId, signal);

export const restartInSupervisorTree = async (
    supervisor: object,
    targetId: string,
): Promise<SupervisionProcessSnapshot | null> =>
    await supervisorRestartProcess(supervisor, targetId);

export const reconcileInSupervisorTree = async (
    supervisor: object,
    desiredCount: number,
): Promise<readonly SupervisionProcessSnapshot[]> =>
    await supervisorReconcileProcesses(supervisor, desiredCount);
