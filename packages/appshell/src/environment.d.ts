export type EnvironmentConfig = {
    available: string[];
    default: string;
    headerName: string;
};
export declare const getEnvironment: () => string;
export declare const setEnvironment: (value: string) => void;
export declare const getEnvironmentHeaderName: () => string;
export declare const setEnvironmentHeaderName: (value: string) => void;
export declare const ensureEnvironmentInRequestInit: (init?: RequestInit) => RequestInit;
export declare const patchFetchWithEnvironment: () => void;
export declare const fetchEnvironmentConfig: () => Promise<EnvironmentConfig | null>;
