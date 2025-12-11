import type { ReactNode } from "react";

export function SectionCard({
	title,
	countLabel,
	children,
}: {
	title: string;
	countLabel?: string;
	children: ReactNode;
}) {
	return (
		<div
			style={{
				background: "#111827",
				border: "1px solid #1f2937",
				borderRadius: "12px",
				padding: "16px",
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "12px",
				}}
			>
				<h2 style={{ margin: 0, fontSize: "18px" }}>{title}</h2>
				{countLabel && <span style={{ fontSize: "12px", color: "#94a3b8" }}>{countLabel}</span>}
			</div>
			{children}
		</div>
	);
}
