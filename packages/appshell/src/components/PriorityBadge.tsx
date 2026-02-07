// FILE_CONTEXT: "context-8c8a8220-e810-49f1-8a7e-e25db7550702"

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
