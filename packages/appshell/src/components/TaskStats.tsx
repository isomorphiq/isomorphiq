// FILE_CONTEXT: "context-403293b1-6388-45d6-bceb-33276c154ab1"

import type { Task } from "@isomorphiq/tasks/types";

interface TaskStatsProps {
	tasks: Task[];
}

export function TaskStats({ tasks }: TaskStatsProps) {
	const total = tasks.length;
	const todo = tasks.filter((t) => t.status === "todo").length;
	const inProgress = tasks.filter((t) => t.status === "in-progress").length;
	const done = tasks.filter((t) => t.status === "done").length;
	const high = tasks.filter((t) => t.priority === "high").length;
	const _medium = tasks.filter((t) => t.priority === "medium").length;
	const _low = tasks.filter((t) => t.priority === "low").length;

	const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;

	const stats = [
		{ label: "Total", value: total, color: "#6b7280" },
		{ label: "Todo", value: todo, color: "#3b82f6" },
		{ label: "In Progress", value: inProgress, color: "#f59e0b" },
		{ label: "Done", value: done, color: "#10b981" },
		{ label: "High Priority", value: high, color: "#ef4444" },
		{ label: "Completion Rate", value: `${completionRate}%`, color: "#8b5cf6" },
	];

	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
				gap: "12px",
			}}
		>
			{stats.map((stat) => (
				<div
					key={stat.label}
					style={{
						background: "#1f2937",
						border: "1px solid #374151",
						borderRadius: "8px",
						padding: "16px",
						textAlign: "center",
					}}
				>
					<div
						style={{
							fontSize: "24px",
							fontWeight: "bold",
							color: stat.color,
							marginBottom: "4px",
						}}
					>
						{stat.value}
					</div>
					<div
						style={{
							fontSize: "12px",
							color: "#9ca3af",
							textTransform: "uppercase",
							letterSpacing: "0.5px",
						}}
					>
						{stat.label}
					</div>
				</div>
			))}
		</div>
	);
}
