import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { impl, method } from "@tsimpl/runtime";
import {
    SupervisableTrait,
    type SupervisionProcessStatus,
} from "@isomorphiq/core-supervision";
import {
    LLMServiceLaunchConfigSchema,
    LLMServiceRecordSchema,
    OpenAICompatibleEndpointsSchema,
    type LLMServiceLaunchConfig,
    type LLMServiceRecord,
    type OpenAICompatibleEndpoints,
} from "./inference-domain.ts";

export type LLMService = {
    readId: () => string;
    readConfig: () => LLMServiceLaunchConfig;
    readRecord: () => Promise<LLMServiceRecord>;
    hasEquivalentConfig: (config: LLMServiceLaunchConfig) => boolean;
};

export type LLMServiceOptions = {
    managedBy?: string;
    stopTimeoutMs?: number;
    minRestartDelayMs?: number;
    maxRestartDelayMs?: number;
    logger?: {
        info: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
    };
};

const nowIso = (): string => new Date().toISOString();

const normalizeSignal = (value: string | undefined): NodeJS.Signals | undefined => {
    if (!value || value.trim().length === 0) {
        return undefined;
    }
    return value.trim() as NodeJS.Signals;
};

const toBaseUrl = (host: string, port: number): string => `http://${host}:${port}`;

const toOpenAiEndpoints = (config: LLMServiceLaunchConfig): OpenAICompatibleEndpoints => {
    const baseUrl = toBaseUrl(config.host, config.port);
    return OpenAICompatibleEndpointsSchema.parse({
        baseUrl,
        models: `${baseUrl}/v1/models`,
        chatCompletions: `${baseUrl}/v1/chat/completions`,
        completions: `${baseUrl}/v1/completions`,
        embeddings: `${baseUrl}/v1/embeddings`,
    }) as OpenAICompatibleEndpoints;
};

const withEnv = (
    baseEnv: NodeJS.ProcessEnv,
    overrides: Record<string, string>,
): NodeJS.ProcessEnv => ({
    ...baseEnv,
    ...overrides,
});

const fetchReady = async (url: string): Promise<boolean> => {
    try {
        const response = await fetch(url, {
            method: "GET",
        });
        return response.ok;
    } catch {
        return false;
    }
};

const waitUntilReady = async (
    url: string,
    timeoutMs: number,
    pollMs: number = 250,
): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ready = await fetchReady(url);
        if (ready) {
            return;
        }
        await sleep(pollMs);
    }
    throw new Error(`Timed out waiting for vLLM healthcheck at ${url}`);
};

const waitForExit = (
    processRef: ChildProcess,
    timeoutMs: number,
): Promise<void> =>
    new Promise((resolve) => {
        if (processRef.exitCode !== null || processRef.signalCode !== null) {
            resolve();
            return;
        }
        const timer = setTimeout(() => {
            if (processRef.exitCode === null && processRef.signalCode === null) {
                processRef.kill("SIGKILL");
            }
        }, timeoutMs);
        processRef.once("exit", () => {
            clearTimeout(timer);
            resolve();
        });
    });

const stableJson = (value: unknown): string => JSON.stringify(value);

export const createLLMService = (
    rawConfig: LLMServiceLaunchConfig,
    options: LLMServiceOptions = {},
): LLMService & object => {
    const config = LLMServiceLaunchConfigSchema.parse(rawConfig) as LLMServiceLaunchConfig;
    const logger = options.logger ?? console;
    const managedBy = options.managedBy ?? "inference-supervisor";
    const stopTimeoutMs = options.stopTimeoutMs ?? 5000;
    const minRestartDelayMs = options.minRestartDelayMs ?? 1000;
    const maxRestartDelayMs = options.maxRestartDelayMs ?? 10000;

    let processRef: ChildProcess | null = null;
    let expectedRunning = false;
    let status: SupervisionProcessStatus = "stopped";
    let startedAt: string | undefined;
    let restartDelayMs = minRestartDelayMs;
    let restartCount = 0;
    let startupPromise: Promise<void> | null = null;
    let restartTimer: NodeJS.Timeout | null = null;
    let lastExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;

    const clearRestartTimer = (): void => {
        if (!restartTimer) {
            return;
        }
        clearTimeout(restartTimer);
        restartTimer = null;
    };

    const launchArgs = (): string[] => [
        ...config.launchCommandArgs,
        "serve",
        config.model,
        "--host",
        config.host,
        "--port",
        String(config.port),
        ...config.vllmArgs,
    ];

    const readEndpoints = (): OpenAICompatibleEndpoints => toOpenAiEndpoints(config);

    const readRecord = async (): Promise<LLMServiceRecord> =>
        LLMServiceRecordSchema.parse({
            id: config.id,
            name: config.name,
            kind: "service",
            status,
            pid: processRef?.pid,
            managedBy,
            startedAt,
            updatedAt: nowIso(),
            model: config.model,
            host: config.host,
            port: config.port,
            command: config.launchCommand,
            endpoints: readEndpoints(),
            restartCount,
            startupTimeoutMs: config.startupTimeoutMs,
            restartOnFailure: config.restartOnFailure,
            metadata: {
                launchCommand: config.launchCommand,
                launchCommandArgs: config.launchCommandArgs,
                vllmArgs: config.vllmArgs,
                healthcheckPath: config.healthcheckPath,
                cwd: config.cwd,
                lastExit,
            },
        }) as LLMServiceRecord;

    const scheduleRestart = (): void => {
        if (!expectedRunning || !config.restartOnFailure) {
            return;
        }
        clearRestartTimer();
        restartTimer = setTimeout(() => {
            restartTimer = null;
            void startProcess("auto-restart").catch((error) => {
                logger.error(`[INFERENCE] Auto restart failed for ${config.id}:`, error);
            });
        }, restartDelayMs);
    };

    const attachProcessLifecycle = (child: ChildProcess): void => {
        child.once("spawn", () => {
            status = "running";
            restartDelayMs = minRestartDelayMs;
        });

        child.once("error", (error) => {
            status = "error";
            logger.error(`[INFERENCE] vLLM process error for ${config.id}:`, error);
        });

        child.once("exit", (code, signal) => {
            processRef = null;
            startupPromise = null;
            lastExit = {
                code,
                signal,
            };
            if (!expectedRunning) {
                status = "stopped";
                return;
            }
            status = "error";
            restartCount += 1;
            restartDelayMs = Math.min(restartDelayMs * 2, maxRestartDelayMs);
            scheduleRestart();
        });
    };

    const startProcess = async (reason: string = "manual"): Promise<void> => {
        if (processRef) {
            return;
        }
        if (startupPromise) {
            await startupPromise;
            return;
        }

        expectedRunning = true;
        clearRestartTimer();
        status = "starting";
        startedAt = startedAt ?? nowIso();
        const args = launchArgs();
        logger.info(`[INFERENCE] Starting model ${config.id} (${reason})`, {
            command: config.launchCommand,
            args,
            cwd: config.cwd,
        });

        const child = spawn(config.launchCommand, args, {
            cwd: config.cwd,
            env: withEnv(process.env, config.env),
            stdio: "inherit",
        });
        processRef = child;
        attachProcessLifecycle(child);

        const healthUrl = `${toBaseUrl(config.host, config.port)}${config.healthcheckPath}`;
        startupPromise = waitUntilReady(healthUrl, config.startupTimeoutMs)
            .then(() => {
                status = "running";
                restartDelayMs = minRestartDelayMs;
            })
            .catch(async (error) => {
                status = "error";
                logger.warn(`[INFERENCE] Model ${config.id} failed to become healthy:`, error);
                if (processRef) {
                    expectedRunning = false;
                    processRef.kill("SIGTERM");
                    await waitForExit(processRef, stopTimeoutMs);
                    processRef = null;
                }
                throw error;
            })
            .finally(() => {
                startupPromise = null;
            });

        await startupPromise;
    };

    const stopProcess = async (signal?: NodeJS.Signals): Promise<void> => {
        expectedRunning = false;
        clearRestartTimer();
        const active = processRef;
        if (!active) {
            status = "stopped";
            return;
        }
        status = "stopping";
        active.kill(signal ?? "SIGTERM");
        await waitForExit(active, stopTimeoutMs);
        processRef = null;
        status = "stopped";
    };

    const service = {
        readId: (): string => config.id,
        readConfig: (): LLMServiceLaunchConfig => ({
            ...config,
            launchCommandArgs: [...config.launchCommandArgs],
            vllmArgs: [...config.vllmArgs],
            env: {
                ...config.env,
            },
        }),
        readRecord,
        hasEquivalentConfig: (nextConfig: LLMServiceLaunchConfig): boolean =>
            stableJson(LLMServiceLaunchConfigSchema.parse(nextConfig)) === stableJson(config),
    };

    impl(SupervisableTrait).for(service, {
        id: method(() => config.id),
        kind: method(() => "service"),
        start: method(async () => {
            await startProcess("trait-start");
            return await readRecord();
        }),
        stop: method(async (_self: unknown, signal?: NodeJS.Signals) => {
            await stopProcess(signal);
            return await readRecord();
        }),
        restart: method(async () => {
            await stopProcess("SIGTERM");
            await startProcess("trait-restart");
            return await readRecord();
        }),
        snapshot: method(async () => await readRecord()),
    });

    return service;
};

export const parseModelStopSignal = (value: string | undefined): NodeJS.Signals | undefined =>
    normalizeSignal(value);
