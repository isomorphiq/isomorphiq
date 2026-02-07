const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

export const normalizeContextData = (value: unknown): Record<string, unknown> =>
    isRecord(value) ? value : {};

export const sleep = (durationMs: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, durationMs));

export const truncateForContext = (value: string, limit: number): string => {
    if (value.length <= limit) {
        return value;
    }
    const omitted = value.length - limit;
    return `${value.slice(0, limit)}\n...[truncated ${omitted} chars]`;
};

export const normalizeStringArray = (value: unknown): string[] => {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? [trimmed] : [];
    }
    if (Array.isArray(value)) {
        return value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }
    return [];
};

export const appendSection = (lines: string[], label: string, items: string[]): string[] => {
    if (items.length === 0) {
        return lines;
    }
    return [...lines, `${label}:`, ...items.map((item) => `- ${item}`)];
};
