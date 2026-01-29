export type EnvironmentConfig = {
    available: string[];
    default: string;
    headerName: string;
};

const ENVIRONMENT_KEY = "isomorphiq.environment";
const ENVIRONMENT_HEADER_KEY = "isomorphiq.environmentHeader";

const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

export const getEnvironment = (): string => {
    if (!isBrowser()) return "production";
    const stored = localStorage.getItem(ENVIRONMENT_KEY);
    return stored && stored.trim().length > 0 ? stored : "production";
};

export const setEnvironment = (value: string): void => {
    if (!isBrowser()) return;
    localStorage.setItem(ENVIRONMENT_KEY, value);
};

export const getEnvironmentHeaderName = (): string => {
    if (!isBrowser()) return "Environment";
    const stored = localStorage.getItem(ENVIRONMENT_HEADER_KEY);
    return stored && stored.trim().length > 0 ? stored : "Environment";
};

export const setEnvironmentHeaderName = (value: string): void => {
    if (!isBrowser()) return;
    if (!value || value.trim().length === 0) return;
    localStorage.setItem(ENVIRONMENT_HEADER_KEY, value);
};

export const ensureEnvironmentInRequestInit = (init?: RequestInit): RequestInit => {
    const headerName = getEnvironmentHeaderName();
    const environment = getEnvironment();
    const headers = new Headers(init?.headers ?? {});
    headers.set(headerName, environment);
    return {
        ...init,
        headers,
    };
};

export const patchFetchWithEnvironment = (): void => {
    if (!isBrowser()) return;
    const anyWindow = window as typeof window & { __environmentFetchPatched?: boolean };
    if (anyWindow.__environmentFetchPatched) return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const headerName = getEnvironmentHeaderName();
        const environment = getEnvironment();
        if (input instanceof Request) {
            const headers = new Headers(input.headers);
            headers.set(headerName, environment);
            const nextInit = { ...init, headers };
            const request = new Request(input, nextInit);
            return originalFetch(request);
        }
        const headers = new Headers(init?.headers ?? {});
        headers.set(headerName, environment);
        return originalFetch(input, { ...init, headers });
    };
    anyWindow.__environmentFetchPatched = true;
};

export const fetchEnvironmentConfig = async (): Promise<EnvironmentConfig | null> => {
    if (!isBrowser()) return null;
    try {
        const response = await window.fetch("/api/environments");
        if (!response.ok) return null;
        const data = (await response.json()) as EnvironmentConfig;
        if (!data || !Array.isArray(data.available)) return null;
        return data;
    } catch {
        return null;
    }
};
