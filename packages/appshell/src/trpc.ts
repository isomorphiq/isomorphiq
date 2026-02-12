// FILE_CONTEXT: "context-5035f3d0-1532-4d7b-ab4d-8a24b945d63f"

import { createWSClient, httpBatchLink, splitLink, wsLink } from "@trpc/client";
import { createTRPCJotai } from "jotai-trpc";
import { getEnvironment, getEnvironmentHeaderName } from "./environment.ts";

type AppRouter = {
	_def: {
		_config: any;
		router: true;
		procedures: Record<string, any>;
		record: Record<string, any>;
		lazy: Record<string, any>;
	};
	createCaller: any;
};

const API_PORT_FALLBACK = 3003;
const ENABLE_TRPC_WS = false;

const getBaseUrl = () => {
	if (typeof window === "undefined") return `http://localhost:${API_PORT_FALLBACK}`;
	// In-browser: same-origin so rsbuild dev proxy handles routing (4173 -> 3003) and prod hits daemon directly.
	return window.location.origin;
};

const getWsUrl = () => {
	if (typeof window === "undefined") return `ws://localhost:${API_PORT_FALLBACK}/trpc`;
	const protocol = window.location.protocol === "https:" ? "wss" : "ws";
	// Use same-origin so rsbuild dev proxy handles WS; in prod daemon serves same origin.
	return `${protocol}://${window.location.host}/trpc`;
};

// Build links with HTTP fallback so data still loads even if WS handshake fails (self-signed cert, firewall, etc.)
const resolveEnvironmentHeaders = (): Record<string, string> => {
	const headerName = getEnvironmentHeaderName();
	return { [headerName]: getEnvironment() };
};

const wsClient =
	typeof window !== "undefined" && ENABLE_TRPC_WS
		? createWSClient({
				url: getWsUrl(),
				connectionParams: () => ({
					headers: resolveEnvironmentHeaders(),
				}),
		  })
		: null;

const links = [
	splitLink({
		condition: (op) => op.type === "subscription" && wsClient !== null,
		true: wsLink({ client: wsClient }),
		false: httpBatchLink({
			url: `${getBaseUrl()}/trpc`,
			headers: () => resolveEnvironmentHeaders(),
		}),
	}),
];

export const trpc = createTRPCJotai<AppRouter>({
	links,
});

export { wsClient };
