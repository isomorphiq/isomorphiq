// FILE_CONTEXT: "context-d36202fb-0088-411e-bd13-dd995addbbae"

const resolveEnvironmentHeaderName = (): string =>
    process.env.ENVIRONMENT_HEADER
    || process.env.ISOMORPHIQ_ENVIRONMENT_HEADER
    || "Environment";

const resolveTestEnvironment = (): string =>
    process.env.ISOMORPHIQ_TEST_ENVIRONMENT
    || process.env.ISOMORPHIQ_ENVIRONMENT
    || "integration";

const shouldPatchFetch = (): boolean => typeof globalThis.fetch === "function";

if (shouldPatchFetch()) {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const headerName = resolveEnvironmentHeaderName();
        const environment = resolveTestEnvironment();
        if (input instanceof Request) {
            const headers = new Headers(input.headers);
            headers.set(headerName, environment);
            const nextInit = { ...init, headers };
            return originalFetch(new Request(input, nextInit));
        }
        const headers = new Headers(init?.headers ?? {});
        headers.set(headerName, environment);
        return originalFetch(input, { ...init, headers });
    };
}
