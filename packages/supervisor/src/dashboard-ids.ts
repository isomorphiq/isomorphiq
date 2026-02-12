const hasRandomUuid = (): boolean =>
    typeof globalThis.crypto !== "undefined" &&
    "randomUUID" in globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function";

export const createWidgetInstanceId = (): string => {
    if (hasRandomUuid()) {
        return globalThis.crypto.randomUUID();
    }

    const timestamp = Date.now().toString(16);
    const randomSegment = Math.random().toString(16).slice(2);

    return `${timestamp}-${randomSegment}`;
};
