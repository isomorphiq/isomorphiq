import type http from "node:http";
import type { MicroserviceHealthSnapshot } from "./domain.ts";

export const writeJsonResponse = (
    res: http.ServerResponse,
    statusCode: number,
    body: unknown,
): void => {
    res.writeHead(statusCode, {
        "Content-Type": "application/json",
    });
    res.end(JSON.stringify(body));
};

export const writeJsonNotFound = (res: http.ServerResponse): void => {
    writeJsonResponse(res, 404, { error: "Not found" });
};

export const normalizePathname = (pathname: string): string =>
    pathname.replace(/\/+$/, "") || "/";

export const resolveTrpcProcedurePath = (
    pathname: string,
    basePath: string = "/trpc",
): string | null => {
    const normalizedBase = normalizePathname(basePath);
    if (pathname === normalizedBase) {
        return null;
    }
    if (!pathname.startsWith(normalizedBase)) {
        return null;
    }
    if (!pathname.startsWith(`${normalizedBase}/`)) {
        return null;
    }
    const raw = pathname.slice(normalizedBase.length + 1);
    return raw.length > 0 ? raw : null;
};

export const tryHandleMicroserviceHealthRequest = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    readHealth: () => Promise<MicroserviceHealthSnapshot>,
): Promise<boolean> => {
    if ((req.method ?? "GET") !== "GET" || pathname !== "/health") {
        return Promise.resolve(false);
    }
    return readHealth()
        .then((health) => {
            writeJsonResponse(res, 200, health);
            return true;
        })
        .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            writeJsonResponse(res, 500, {
                status: "error",
                error: message,
            });
            return true;
        });
};
