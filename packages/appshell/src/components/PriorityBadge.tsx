import type { Task } from "@isomorphiq/tasks/types";

const colors: Record<Task["priority"], string> = {
	high: "🟥",
	medium: "🟧",
	low: "🟩",
};

export function PriorityBadge({ priority }: { priority: Task["priority"] }) {
	return (
		<span style={{ fontSize: "12px" }}>
			{colors[priority]} {priority}
		</span>
	);
}
