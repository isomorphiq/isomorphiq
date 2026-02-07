import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { Box, Text, render } from "ink";
import { createWorkerManagerClient, type WorkerRecord } from "@isomorphiq/worker-manager";
import {
    buildServiceEnvironment,
    createSupervisorServiceCatalog,
    resolveServiceEndpoints,
    type ResolvedSupervisorServiceEndpoint,
    type SupervisorServiceConfig,
} from "./service-catalog.ts";

type ServiceHealth = "running" | "degraded" | "stopped" | "disabled" | "missing-entry";

type EndpointProbeResult = {
    label: string;
    protocol: "tcp" | "http";
    host: string;
    port: number;
    healthPath?: string;
    enabled: boolean;
    reachable: boolean;
};

type SupervisorServiceRow = {
    id: SupervisorServiceConfig["id"];
    name: string;
    description: string;
    entryRelativePath: string;
    entryExists: boolean;
    status: ServiceHealth;
    endpoints: readonly EndpointProbeResult[];
    delegatedProcesses: readonly WorkerRecord[];
};

const hasFile = (candidate: string): boolean => {
    try {
        fs.accessSync(candidate, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
};

const normalizeProbeHost = (host: string): string => {
    if (host === "0.0.0.0" || host === "::") {
        return "127.0.0.1";
    }
    return host;
};

const probeTcpEndpoint = (
    endpoint: ResolvedSupervisorServiceEndpoint,
    timeoutMs: number,
): Promise<boolean> =>
    new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;

        const finish = (value: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            socket.destroy();
            resolve(value);
        };

        socket.setTimeout(timeoutMs);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
        socket.connect(endpoint.port, normalizeProbeHost(endpoint.host));
    });

const isHealthyStatusValue = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    return ![
        "error",
        "failed",
        "down",
        "stopped",
        "unhealthy",
    ].includes(normalized);
};

const probeHttpHealthEndpoint = async (
    endpoint: ResolvedSupervisorServiceEndpoint,
    timeoutMs: number,
): Promise<boolean> => {
    const host = normalizeProbeHost(endpoint.host);
    const healthPath = endpoint.healthPath ?? "/";
    const url = `http://${host}:${endpoint.port}${healthPath}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                Accept: "application/json",
            },
            signal: controller.signal,
        });

        if (!response.ok) {
            return false;
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("application/json")) {
            return true;
        }

        const body = (await response.json()) as Record<string, unknown>;
        const statusValue = body.status;
        if (typeof statusValue !== "string") {
            return true;
        }
        return isHealthyStatusValue(statusValue);
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
    }
};

const resolveServiceHealth = (
    entryExists: boolean,
    endpoints: readonly EndpointProbeResult[],
): ServiceHealth => {
    if (!entryExists) {
        return "missing-entry";
    }

    const enabledEndpoints = endpoints.filter((endpoint) => endpoint.enabled);
    if (enabledEndpoints.length === 0) {
        return "disabled";
    }

    const reachableCount = enabledEndpoints.filter((endpoint) => endpoint.reachable).length;
    if (reachableCount === 0) {
        return "stopped";
    }
    if (reachableCount < enabledEndpoints.length) {
        return "degraded";
    }
    return "running";
};

const probeEndpoint = async (
    endpoint: ResolvedSupervisorServiceEndpoint,
): Promise<EndpointProbeResult> => {
    const reachable = endpoint.enabled
        ? endpoint.protocol === "http"
            ? await probeHttpHealthEndpoint(endpoint, 1000)
            : await probeTcpEndpoint(endpoint, 500)
        : false;
    return {
        label: endpoint.label,
        protocol: endpoint.protocol,
        host: endpoint.host,
        port: endpoint.port,
        healthPath: endpoint.healthPath,
        enabled: endpoint.enabled,
        reachable,
    };
};

const toRow = async (
    root: string,
    service: SupervisorServiceConfig,
): Promise<SupervisorServiceRow> => {
    const entryExists = hasFile(service.entry);
    const effectiveEnv = buildServiceEnvironment(process.env, service);
    const resolvedEndpoints = resolveServiceEndpoints(service, effectiveEnv);
    const endpoints = await Promise.all(
        resolvedEndpoints.map((endpoint) => probeEndpoint(endpoint)),
    );
    const status = resolveServiceHealth(entryExists, endpoints);
    const delegatedProcesses =
        service.id === "worker-manager"
            ? await (async () => {
                const endpoint = endpoints.find(
                    (item) => item.enabled && item.protocol === "http" && item.reachable,
                );
                if (!endpoint) {
                    return [];
                }
                const baseUrl = `http://${normalizeProbeHost(endpoint.host)}:${endpoint.port}`;
                try {
                    const client = createWorkerManagerClient({ baseUrl });
                    return [...(await client.listWorkers())];
                } catch (error) {
                    console.warn("[SUPERVISOR-PS] Failed to fetch workers from worker-manager:", error);
                    return [];
                }
            })()
            : [];

    return {
        id: service.id,
        name: service.name,
        description: service.description,
        entryRelativePath: path.relative(root, service.entry) || service.entry,
        entryExists,
        status,
        endpoints,
        delegatedProcesses,
    };
};

const statusColor = (status: ServiceHealth): string => {
    if (status === "running") {
        return "green";
    }
    if (status === "degraded") {
        return "yellow";
    }
    if (status === "missing-entry") {
        return "red";
    }
    if (status === "disabled") {
        return "gray";
    }
    return "red";
};

const ServiceRow = ({ service }: { service: SupervisorServiceRow }): React.ReactElement =>
    React.createElement(
        Box,
        { flexDirection: "column", marginBottom: 1, borderStyle: "round", borderColor: "gray", paddingX: 1 },
        React.createElement(
            Box,
            {},
            React.createElement(Text, { color: "cyan" }, service.name),
            React.createElement(Text, {}, "  "),
            React.createElement(Text, { color: statusColor(service.status) }, service.status),
        ),
        React.createElement(Text, { color: "gray" }, service.description),
        React.createElement(Text, { color: "gray" }, `entry: ${service.entryRelativePath}`),
        ...service.endpoints.map((endpoint) =>
            React.createElement(
                Text,
                { key: `${service.id}:${endpoint.label}`, color: "gray" },
                `${endpoint.label} (${endpoint.protocol}): ` +
                    `${endpoint.host}:${endpoint.port}` +
                    `${endpoint.protocol === "http" ? endpoint.healthPath ?? "" : ""} ` +
                    `${!endpoint.enabled ? "disabled" : endpoint.reachable ? "running" : "stopped"}`,
            ),
        ),
        ...service.delegatedProcesses.map((worker) =>
            React.createElement(
                Text,
                { key: `${service.id}:worker:${worker.id}`, color: "gray" },
                `delegated worker: ${worker.id} status=${worker.status} ` +
                    `pid=${worker.pid ?? "n/a"} port=${worker.port}`,
            ),
        ),
    );

const countByStatus = (
    rows: readonly SupervisorServiceRow[],
    status: ServiceHealth,
): number => rows.filter((row) => row.status === status).length;

const SupervisorPsApp = ({ rows }: { rows: readonly SupervisorServiceRow[] }): React.ReactElement => {
    const runningCount = countByStatus(rows, "running");
    const degradedCount = countByStatus(rows, "degraded");
    const stoppedCount = countByStatus(rows, "stopped");
    const disabledCount = countByStatus(rows, "disabled");
    const missingCount = countByStatus(rows, "missing-entry");

    return React.createElement(
        Box,
        { flexDirection: "column", paddingX: 1, paddingY: 1 },
        React.createElement(Text, { bold: true }, "Supervisor Services"),
        React.createElement(
            Text,
            { color: "gray" },
            `running=${runningCount} degraded=${degradedCount} stopped=${stoppedCount} disabled=${disabledCount} missing=${missingCount}`,
        ),
        React.createElement(Box, { marginBottom: 1 }),
        ...rows.map((row) =>
            React.createElement(ServiceRow, {
                key: row.id,
                service: row,
            }),
        ),
    );
};

async function main(): Promise<void> {
    const { root, services } = createSupervisorServiceCatalog();
    const rows = await Promise.all(services.map((service) => toRow(root, service)));
    const app = render(React.createElement(SupervisorPsApp, { rows }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    app.unmount();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error("[SUPERVISOR-PS] Failed to render process list:", error);
        process.exit(1);
    });
}

export { main as showSupervisorProcessList };
