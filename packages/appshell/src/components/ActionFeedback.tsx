// FILE_CONTEXT: "context-d1e2e3d3-077d-4f0c-89b7-254d552f593a"

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type FeedbackTone = "success" | "error" | "info";

type FeedbackToastInput = {
    message: string;
    tone?: FeedbackTone;
};

type FeedbackToast = {
    id: string;
    message: string;
    tone: FeedbackTone;
};

type FeedbackContextValue = {
    pushToast: (input: FeedbackToastInput) => void;
};

type FeedbackToastStackProps = {
    toasts: FeedbackToast[];
    onDismiss: (id: string) => void;
};

type FeedbackToastItemProps = {
    toast: FeedbackToast;
    onDismiss: (id: string) => void;
};

type ActionErrorBannerProps = {
    message: string;
    actionLabel?: string;
    onAction?: () => void;
    onDismiss?: () => void;
};

const defaultContext: FeedbackContextValue = {
    pushToast: () => undefined,
};

const FeedbackContext = createContext<FeedbackContextValue>(defaultContext);

const createToastId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const toneStyles: Record<FeedbackTone, { border: string; background: string; color: string }> = {
    success: {
        border: "1px solid #10b981",
        background: "#064e3b",
        color: "#d1fae5",
    },
    error: {
        border: "1px solid #ef4444",
        background: "#7f1d1d",
        color: "#fee2e2",
    },
    info: {
        border: "1px solid #38bdf8",
        background: "#0b1f33",
        color: "#e0f2fe",
    },
};

function FeedbackToastItem({ toast, onDismiss }: FeedbackToastItemProps) {
    useEffect(() => {
        const timeout = setTimeout(() => {
            onDismiss(toast.id);
        }, 2400);
        return () => clearTimeout(timeout);
    }, [onDismiss, toast.id]);

    const toneStyle = toneStyles[toast.tone];

    return (
        <div
            role="status"
            aria-live="polite"
            style={{
                ...toneStyle,
                borderRadius: "999px",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 600,
                boxShadow: "0 12px 20px rgba(0, 0, 0, 0.3)",
            }}
        >
            {toast.message}
        </div>
    );
}

function FeedbackToastStack({ toasts, onDismiss }: FeedbackToastStackProps) {
    if (toasts.length === 0) {
        return null;
    }

    return (
        <div
            role="region"
            aria-live="polite"
            aria-label="Notifications"
            style={{
                position: "fixed",
                top: "20px",
                right: "20px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                zIndex: 9999,
                pointerEvents: "none",
            }}
        >
            {toasts.map((toast) => (
                <FeedbackToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
            ))}
        </div>
    );
}

export function FeedbackToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<FeedbackToast[]>([]);

    const pushToast = useCallback((input: FeedbackToastInput) => {
        const tone = input.tone ?? "success";
        const toast: FeedbackToast = {
            id: createToastId(),
            message: input.message,
            tone,
        };
        setToasts((current) => [...current, toast]);
    }, []);

    const dismissToast = useCallback((id: string) => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }, []);

    return (
        <FeedbackContext.Provider value={{ pushToast }}>
            <FeedbackToastStack toasts={toasts} onDismiss={dismissToast} />
            {children}
        </FeedbackContext.Provider>
    );
}

export function useFeedbackToasts() {
    return useContext(FeedbackContext);
}

export function ActionErrorBanner({
    message,
    actionLabel = "Retry",
    onAction,
    onDismiss,
}: ActionErrorBannerProps) {
    return (
        <div
            role="alert"
            aria-live="assertive"
            style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
                padding: "10px 12px",
                borderRadius: "10px",
                border: "1px solid #ef4444",
                background: "#7f1d1d",
                color: "#fee2e2",
                fontSize: "12px",
                fontWeight: 600,
                boxShadow: "0 10px 16px rgba(127, 29, 29, 0.35)",
            }}
        >
            <span style={{ flex: "1 1 auto" }}>{message}</span>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {onAction ? (
                    <button
                        type="button"
                        onClick={onAction}
                        style={{
                            padding: "6px 10px",
                            borderRadius: "999px",
                            border: "1px solid #fecaca",
                            background: "#b91c1c",
                            color: "#fff5f5",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: "pointer",
                        }}
                    >
                        {actionLabel}
                    </button>
                ) : null}
                {onDismiss ? (
                    <button
                        type="button"
                        onClick={onDismiss}
                        style={{
                            padding: "6px 10px",
                            borderRadius: "999px",
                            border: "1px solid #fecaca",
                            background: "transparent",
                            color: "#fee2e2",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: "pointer",
                        }}
                    >
                        Dismiss
                    </button>
                ) : null}
            </div>
        </div>
    );
}
