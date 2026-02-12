// FILE_CONTEXT: "context-85a9ce5b-cf45-48ec-a50d-f5c4360397fe"

export function LegendBand() {
    return (
        <div
            style={{
                display: "flex",
                gap: "8px",
                marginBottom: "8px",
                color: "var(--color-text-muted)",
                fontSize: "12px",
            }}
        >
            <span>🟥 high</span>
            <span>🟧 medium</span>
            <span>🟩 low</span>
        </div>
    );
}
