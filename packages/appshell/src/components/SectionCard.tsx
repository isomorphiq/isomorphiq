// FILE_CONTEXT: "context-18c29b0c-012e-416b-b475-76ae37ae7f14"

import type { ReactNode } from "react";
import { useId } from "react";

export function SectionCard({
    title,
    countLabel,
    children,
}: {
    title: string;
    countLabel?: string;
    children: ReactNode;
}) {
    const titleId = useId();
    const countId = countLabel ? `${titleId}-count` : undefined;

    return (
        <section
            role="region"
            aria-labelledby={titleId}
            aria-describedby={countId}
            style={{
                background: "var(--color-surface-primary)",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "12px",
                padding: "16px",
                boxShadow: "0 10px 24px var(--color-shadow-lg)",
            }}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: "12px",
                    flexWrap: "wrap",
                    gap: "8px",
                }}
            >
                <h2 id={titleId} style={{ margin: 0, fontSize: "18px", color: "var(--color-text-primary)" }}>
                    {title}
                </h2>
                {countLabel && (
                    <span id={countId} style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                        {countLabel}
                    </span>
                )}
            </div>
            {children}
        </section>
    );
}
