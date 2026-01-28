export function LegendBand() {
	return (
		<div
			style={{
				display: "flex",
				gap: "8px",
				marginBottom: "8px",
				color: "#9ca3af",
				fontSize: "12px",
			}}
		>
			<span>🟥 high</span>
			<span>🟧 medium</span>
			<span>🟩 low</span>
		</div>
	);
}
