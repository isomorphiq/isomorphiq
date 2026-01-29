import type { IncomingHttpHeaders } from "node:http";
import { ConfigManager, type AppConfig } from "../config/config.ts";

export type EnvironmentConfig = AppConfig["environments"];

const normalizeEnvironmentName = (value: string): string => value.trim().toLowerCase();

const readHeaderValue = (
	headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
	headerName: string,
): string | undefined => {
	const key = headerName.toLowerCase();
	const direct = headers[key];
	if (Array.isArray(direct)) {
		return direct.find((value) => typeof value === "string" && value.trim().length > 0);
	}
	if (typeof direct === "string" && direct.trim().length > 0) {
		return direct;
	}
	if (direct) {
		return String(direct);
	}
	const match = Object.entries(headers).find(([name]) => name.toLowerCase() === key);
	if (!match) return undefined;
	const [, value] = match;
	if (Array.isArray(value)) {
		return value.find((entry) => typeof entry === "string" && entry.trim().length > 0);
	}
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

export const resolveEnvironmentValue = (
	value: string | undefined,
	config: EnvironmentConfig = ConfigManager.getInstance().getEnvironmentConfig(),
): string => {
	if (!value || value.trim().length === 0) {
		return config.default;
	}
	const normalized = normalizeEnvironmentName(value);
	const match = config.available.find((env) => env === normalized);
	return match ?? config.default;
};

export const resolveEnvironmentFromHeaders = (
	headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
	config: EnvironmentConfig = ConfigManager.getInstance().getEnvironmentConfig(),
): string => {
	const headerValue = readHeaderValue(headers, config.headerName);
	return resolveEnvironmentValue(headerValue, config);
};
