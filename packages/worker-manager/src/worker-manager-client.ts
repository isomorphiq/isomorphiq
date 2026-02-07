import {
    WorkerListResponseSchema,
    WorkerManagerHealthSchema,
    WorkerOperationResponseSchema,
    type WorkerManagerHealth,
    type WorkerRecord,
    type WorkerStartRequest,
} from "./worker-manager-domain.ts";

export type WorkerManagerClientOptions = {
    baseUrl: string;
};

export type WorkerManagerClient = {
    health: () => Promise<WorkerManagerHealth>;
    listWorkers: () => Promise<readonly WorkerRecord[]>;
    reconcileWorkers: (desiredCount: number) => Promise<readonly WorkerRecord[]>;
    startWorker: (request?: WorkerStartRequest) => Promise<WorkerRecord | null>;
    startWorkerById: (workerId: string, request?: WorkerStartRequest) => Promise<WorkerRecord | null>;
    stopWorker: (workerId: string, signal?: NodeJS.Signals) => Promise<WorkerRecord | null>;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const readResponseBody = async (response: Response): Promise<unknown> => {
    const text = await response.text();
    if (text.trim().length === 0) {
        return {};
    }
    return JSON.parse(text);
};

const requestJson = async (
    baseUrl: string,
    pathname: string,
    init?: RequestInit,
): Promise<unknown> => {
    const response = await fetch(`${baseUrl}${pathname}`, init);
    const body = await readResponseBody(response);
    if (!response.ok) {
        throw new Error(
            `Worker manager request failed (${response.status} ${response.statusText})`,
        );
    }
    return body;
};

export const createWorkerManagerClient = (
    options: WorkerManagerClientOptions,
): WorkerManagerClient => {
    const baseUrl = trimTrailingSlash(options.baseUrl);

    const health = async (): Promise<WorkerManagerHealth> => {
        const response = await requestJson(baseUrl, "/health");
        return WorkerManagerHealthSchema.parse(response);
    };

    const listWorkers = async (): Promise<readonly WorkerRecord[]> => {
        const response = await requestJson(baseUrl, "/workers");
        return WorkerListResponseSchema.parse(response).workers;
    };

    const reconcileWorkers = async (
        desiredCount: number,
    ): Promise<readonly WorkerRecord[]> => {
        const response = await requestJson(baseUrl, "/workers/reconcile", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ desiredCount }),
        });
        return WorkerOperationResponseSchema.parse(response).workers ?? [];
    };

    const startWorker = async (
        request: WorkerStartRequest = {},
    ): Promise<WorkerRecord | null> => {
        const response = await requestJson(baseUrl, "/workers/start", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
        });
        return WorkerOperationResponseSchema.parse(response).worker ?? null;
    };

    const startWorkerById = async (
        workerId: string,
        request: WorkerStartRequest = {},
    ): Promise<WorkerRecord | null> => {
        const encodedId = encodeURIComponent(workerId);
        const response = await requestJson(baseUrl, `/workers/${encodedId}/start`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
        });
        return WorkerOperationResponseSchema.parse(response).worker ?? null;
    };

    const stopWorker = async (
        workerId: string,
        signal?: NodeJS.Signals,
    ): Promise<WorkerRecord | null> => {
        const encodedId = encodeURIComponent(workerId);
        const response = await requestJson(baseUrl, `/workers/${encodedId}/stop`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(
                signal
                    ? {
                          signal,
                      }
                    : {},
            ),
        });
        return WorkerOperationResponseSchema.parse(response).worker ?? null;
    };

    return {
        health,
        listWorkers,
        reconcileWorkers,
        startWorker,
        startWorkerById,
        stopWorker,
    };
};
