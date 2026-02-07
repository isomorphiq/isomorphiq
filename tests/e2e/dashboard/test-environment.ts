import { createServer } from "node:net";

export const NETWORK_SKIP_REASON = "Local socket operations are not permitted in this runtime";

let cachedLocalSocketCapability: boolean | null = null;
let cachedDashboardReachability: Map<string, boolean> = new Map();

export const canUseLocalSockets = async (): Promise<boolean> => {
    if (cachedLocalSocketCapability !== null) {
        return cachedLocalSocketCapability;
    }

    const server = createServer();
    try {
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => resolve());
        });
        cachedLocalSocketCapability = true;
        return true;
    } catch {
        cachedLocalSocketCapability = false;
        return false;
    } finally {
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }
};

export const canReachDashboard = async (baseUrl = "http://localhost:3005"): Promise<boolean> => {
    if (cachedDashboardReachability.has(baseUrl)) {
        return cachedDashboardReachability.get(baseUrl) ?? false;
    }

    try {
        const response = await fetch(`${baseUrl}/api/health`);
        const reachable = response.ok;
        cachedDashboardReachability.set(baseUrl, reachable);
        return reachable;
    } catch {
        cachedDashboardReachability.set(baseUrl, false);
        return false;
    }
};
