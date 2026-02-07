import { impl, method } from "@tsimpl/runtime";
import {
    SupervisableTrait,
    SupervisorTrait,
    type SupervisionProcessSnapshot,
    type SupervisionProcessStatus,
} from "@isomorphiq/core-supervision";
import {
    InferenceServiceHealthSchema,
    LLMServiceLaunchConfigSchema,
    TransitionModelCommandSchema,
    type InferenceServiceHealth,
    type LLMServiceLaunchConfig,
    type LLMServiceRecord,
    type TransitionModelCommand,
} from "./inference-domain.ts";
import { createLLMService, parseModelStopSignal, type LLMService } from "./llm-service.ts";

export type InferenceSupervisorServiceOptions = {
    supervisorId?: string;
    supervisorName?: string;
    initialModels?: readonly LLMServiceLaunchConfig[];
    autoStartInitialModels?: boolean;
};

export type InferenceSupervisorService = {
    supervisor: object;
    open: () => Promise<void>;
    close: () => Promise<void>;
    health: () => Promise<InferenceServiceHealth>;
    listModels: () => Promise<readonly LLMServiceRecord[]>;
    getModel: (targetId: string) => Promise<LLMServiceRecord | null>;
    serveModel: (config: LLMServiceLaunchConfig) => Promise<LLMServiceRecord>;
    stopModel: (targetId: string, signal?: NodeJS.Signals) => Promise<LLMServiceRecord | null>;
    restartModel: (targetId: string) => Promise<LLMServiceRecord | null>;
    applyTransition: (command: TransitionModelCommand) => Promise<LLMServiceRecord | null>;
    listProcesses: () => Promise<readonly SupervisionProcessSnapshot[]>;
    startProcess: (targetId: string) => Promise<SupervisionProcessSnapshot | null>;
    stopProcess: (
        targetId: string,
        signal?: NodeJS.Signals,
    ) => Promise<SupervisionProcessSnapshot | null>;
    restartProcess: (targetId: string) => Promise<SupervisionProcessSnapshot | null>;
    reconcileProcesses: (desiredCount: number) => Promise<readonly SupervisionProcessSnapshot[]>;
};

const nowIso = (): string => new Date().toISOString();

const isRunningStatus = (status: SupervisionProcessStatus): boolean =>
    status === "running" || status === "starting";

const toSnapshot = (record: LLMServiceRecord): SupervisionProcessSnapshot => ({
    id: record.id,
    name: record.name,
    kind: "service",
    status: record.status,
    pid: record.pid,
    managedBy: record.managedBy,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    metadata: {
        ...record.metadata,
        model: record.model,
        host: record.host,
        port: record.port,
        endpoints: record.endpoints,
        restartCount: record.restartCount,
    },
});

const sortedById = <T extends { id?: string }>(records: readonly T[]): readonly T[] =>
    [...records].sort((left, right) =>
        (left.id ?? "").localeCompare(right.id ?? ""),
    );

const normalizeDesiredCount = (value: number): number => {
    if (!Number.isFinite(value) || value < 0) {
        return 0;
    }
    return Math.floor(value);
};

export const createInferenceSupervisorService = (
    options: InferenceSupervisorServiceOptions = {},
): InferenceSupervisorService => {
    const supervisorId = options.supervisorId ?? "inference-supervisor";
    const supervisorName = options.supervisorName ?? "inference-supervisor";
    const initialModels = (options.initialModels ?? []).map((entry) =>
        LLMServiceLaunchConfigSchema.parse(entry) as LLMServiceLaunchConfig,
    );
    const autoStartInitialModels = options.autoStartInitialModels === true;

    const managedServices = new Map<string, LLMService & object>();
    let status: SupervisionProcessStatus = "stopped";
    let startedAt: string | undefined;
    let opened = false;

    const registerModel = async (
        config: LLMServiceLaunchConfig,
    ): Promise<LLMService & object> => {
        const normalized = LLMServiceLaunchConfigSchema.parse(config) as LLMServiceLaunchConfig;
        const existing = managedServices.get(normalized.id);
        if (existing && existing.hasEquivalentConfig(normalized)) {
            return existing;
        }
        if (existing) {
            await SupervisableTrait.stop(existing as any, "SIGTERM");
        }
        const next = createLLMService(normalized, {
            managedBy: supervisorId,
        });
        managedServices.set(normalized.id, next);
        return next;
    };

    const listModels = async (): Promise<readonly LLMServiceRecord[]> => {
        const records = await Promise.all(
            Array.from(managedServices.values()).map(async (service) =>
                await service.readRecord(),
            ),
        );
        return sortedById(records);
    };

    const getModel = async (targetId: string): Promise<LLMServiceRecord | null> => {
        const service = managedServices.get(targetId);
        if (!service) {
            return null;
        }
        return await service.readRecord();
    };

    const serveModel = async (config: LLMServiceLaunchConfig): Promise<LLMServiceRecord> => {
        const service = await registerModel(config);
        await SupervisableTrait.start(service as any);
        return await service.readRecord();
    };

    const stopModel = async (
        targetId: string,
        signal?: NodeJS.Signals,
    ): Promise<LLMServiceRecord | null> => {
        const service = managedServices.get(targetId);
        if (!service) {
            return null;
        }
        await SupervisableTrait.stop(service as any, signal);
        return await service.readRecord();
    };

    const restartModel = async (targetId: string): Promise<LLMServiceRecord | null> => {
        const service = managedServices.get(targetId);
        if (!service) {
            return null;
        }
        await SupervisableTrait.restart(service as any);
        return await service.readRecord();
    };

    const open = async (): Promise<void> => {
        if (opened) {
            status = "running";
            return;
        }
        status = "starting";
        for (const config of initialModels) {
            await registerModel(config);
        }
        if (autoStartInitialModels) {
            for (const service of managedServices.values()) {
                await SupervisableTrait.start(service as any);
            }
        }
        opened = true;
        status = "running";
        startedAt = startedAt ?? nowIso();
    };

    const close = async (): Promise<void> => {
        status = "stopping";
        for (const service of managedServices.values()) {
            await SupervisableTrait.stop(service as any, "SIGTERM");
        }
        opened = false;
        status = "stopped";
    };

    const health = async (): Promise<InferenceServiceHealth> => {
        const records = await listModels();
        const running = records.filter((record) => isRunningStatus(record.status)).length;
        return InferenceServiceHealthSchema.parse({
            status: "ok",
            service: "inference-service",
            supervisorId,
            pid: process.pid,
            models: {
                running,
                total: records.length,
            },
        }) as InferenceServiceHealth;
    };

    const listProcesses = async (): Promise<readonly SupervisionProcessSnapshot[]> =>
        (await listModels()).map((record) => toSnapshot(record));

    const startProcess = async (
        targetId: string,
    ): Promise<SupervisionProcessSnapshot | null> => {
        const service = managedServices.get(targetId);
        if (!service) {
            return null;
        }
        await SupervisableTrait.start(service as any);
        return toSnapshot(await service.readRecord());
    };

    const stopProcess = async (
        targetId: string,
        signal?: NodeJS.Signals,
    ): Promise<SupervisionProcessSnapshot | null> => {
        const service = managedServices.get(targetId);
        if (!service) {
            return null;
        }
        await SupervisableTrait.stop(service as any, signal);
        return toSnapshot(await service.readRecord());
    };

    const restartProcess = async (
        targetId: string,
    ): Promise<SupervisionProcessSnapshot | null> => {
        const service = managedServices.get(targetId);
        if (!service) {
            return null;
        }
        await SupervisableTrait.restart(service as any);
        return toSnapshot(await service.readRecord());
    };

    const reconcileProcesses = async (
        desiredCount: number,
    ): Promise<readonly SupervisionProcessSnapshot[]> => {
        const desired = normalizeDesiredCount(desiredCount);
        const records = await listModels();
        const sorted = sortedById(records);
        const running = sorted.filter((record) => isRunningStatus(record.status));

        if (running.length < desired) {
            const stopped = sorted.filter((record) => !isRunningStatus(record.status));
            const toStart = stopped.slice(0, Math.max(0, desired - running.length));
            for (const record of toStart) {
                if (!record.id) {
                    continue;
                }
                const service = managedServices.get(record.id);
                if (service) {
                    await SupervisableTrait.start(service as any);
                }
            }
        }

        if (running.length > desired) {
            const toStop = [...running].reverse().slice(0, running.length - desired);
            for (const record of toStop) {
                if (!record.id) {
                    continue;
                }
                const service = managedServices.get(record.id);
                if (service) {
                    await SupervisableTrait.stop(service as any, "SIGTERM");
                }
            }
        }

        return await listProcesses();
    };

    const applyTransition = async (
        command: TransitionModelCommand,
    ): Promise<LLMServiceRecord | null> => {
        const normalized = TransitionModelCommandSchema.parse(command) as TransitionModelCommand;

        if (normalized.action === "noop") {
            if (normalized.targetId) {
                return await getModel(normalized.targetId);
            }
            return null;
        }

        if (normalized.action === "start") {
            if (!normalized.config) {
                throw new Error(
                    "Transition action \"start\" requires a model config payload",
                );
            }
            return await serveModel(normalized.config);
        }

        const targetId = normalized.targetId ?? normalized.config?.id;
        if (!targetId) {
            throw new Error(
                `Transition action \"${normalized.action}\" requires targetId or config.id`,
            );
        }

        if (normalized.action === "stop") {
            return await stopModel(targetId, parseModelStopSignal(normalized.signal));
        }

        if (normalized.action === "restart") {
            return await restartModel(targetId);
        }

        return null;
    };

    const supervisor = {};

    impl(SupervisableTrait).for(supervisor, {
        id: method(() => supervisorId),
        kind: method(() => "supervisor"),
        start: method(async () => {
            await open();
            return {
                id: supervisorId,
                name: supervisorName,
                kind: "supervisor",
                status,
                pid: process.pid,
                managedBy: "system",
                startedAt,
                updatedAt: nowIso(),
                metadata: {
                    models: await listModels(),
                },
            };
        }),
        stop: method(async (_self: unknown, signal?: NodeJS.Signals) => {
            await close();
            return {
                id: supervisorId,
                name: supervisorName,
                kind: "supervisor",
                status,
                pid: process.pid,
                managedBy: `signal:${signal ?? "SIGTERM"}`,
                startedAt,
                updatedAt: nowIso(),
                metadata: {
                    models: await listModels(),
                },
            };
        }),
        restart: method(async () => {
            await close();
            await open();
            return {
                id: supervisorId,
                name: supervisorName,
                kind: "supervisor",
                status,
                pid: process.pid,
                managedBy: "system",
                startedAt,
                updatedAt: nowIso(),
                metadata: {
                    models: await listModels(),
                },
            };
        }),
        snapshot: method(async () => ({
            id: supervisorId,
            name: supervisorName,
            kind: "supervisor",
            status,
            pid: process.pid,
            managedBy: "system",
            startedAt,
            updatedAt: nowIso(),
            metadata: {
                models: await listModels(),
            },
        })),
    });

    impl(SupervisorTrait).for(supervisor, {
        listProcesses: method(async () => await listProcesses()),
        startProcess: method(async (_self: unknown, targetId: string) =>
            await startProcess(targetId),
        ),
        stopProcess: method(
            async (_self: unknown, targetId: string, signal?: NodeJS.Signals) =>
                await stopProcess(targetId, signal),
        ),
        restartProcess: method(async (_self: unknown, targetId: string) =>
            await restartProcess(targetId),
        ),
        reconcileProcesses: method(async (_self: unknown, desiredCount: number) =>
            await reconcileProcesses(desiredCount),
        ),
    });

    return {
        supervisor,
        open,
        close,
        health,
        listModels,
        getModel,
        serveModel,
        stopModel,
        restartModel,
        applyTransition,
        listProcesses,
        startProcess,
        stopProcess,
        restartProcess,
        reconcileProcesses,
    };
};
