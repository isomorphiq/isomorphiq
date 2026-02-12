import type { Task } from "@isomorphiq/tasks/types";

const colors: Record<Task["type"] | "unknown", { bg: string; text: string }> = {
	theme: { bg: "#ecfccb", text: "#3f6212" },
	initiative: { bg: "#ccfbf1", text: "#0f766e" },
	feature: { bg: "#dbeafe", text: "#1d4ed8" },
	story: { bg: "#fef3c7", text: "#b45309" },
	task: { bg: "#ecfdf3", text: "#15803d" },
	implementation: { bg: "#e0f2fe", text: "#0369a1" },
	integration: { bg: "#f0f9ff", text: "#0ea5e9" },
	testing: { bg: "#fee2e2", text: "#b91c1c" },
	research: { bg: "#f3e8ff", text: "#7c3aed" },
	unknown: { bg: "#e5e7eb", text: "#374151" },
};

export function TypeBadge({ type }: { type: string | undefined }) {
	const palette = colors[type as Task["type"]] ?? colors.unknown;
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: "6px",
				padding: "4px 8px",
				borderRadius: "999px",
				background: palette.bg,
				color: palette.text,
				fontWeight: 700,
				fontSize: "11px",
				letterSpacing: "0.02em",
				textTransform: "uppercase",
			}}
		>
			{type ?? "unknown"}
		</span>
	);
}
