// FILE_CONTEXT: "context-20f5bd89-44b0-4217-bf82-e305036e1707"

import type { Task } from "@isomorphiq/tasks/types";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SectionCard } from "../../components/SectionCard.tsx";
import { QueueList } from "../../components/TaskCard.tsx";
import { LoadingSpinner } from "../../components/UIComponents.tsx";
import type { OfflineTask } from "../../hooks/useOfflineSync.ts";

const visuallyHiddenStyle: React.CSSProperties = {
	position: "absolute",
	width: "1px",
	height: "1px",
	padding: 0,
	margin: "-1px",
	overflow: "hidden",
	clip: "rect(0 0 0 0)",
	whiteSpace: "nowrap",
	border: 0,
};

type QueueFilterType = "all" | "implementation" | "story" | "epic" | "feature" | "initiative";

const filterOptions: { value: QueueFilterType; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "implementation", label: "Implementation/Bugfix" },
	{ value: "story", label: "Story" },
	{ value: "epic", label: "Epic" },
	{ value: "feature", label: "Feature" },
	{ value: "initiative", label: "Initiative" },
];

const matchesFilterType = (task: Task | OfflineTask, filterType: QueueFilterType): boolean => {
	if (filterType === "all") return true;
	if (filterType === "epic") return task.type === "feature";
	if (filterType === "implementation")
		return task.type === "implementation" || task.type === "task";
	return task.type === filterType;
};

type QueueSectionProps = {
	isMobile: boolean;
	tasks: Array<Task | OfflineTask>;
	onStatusChange: (taskId: string, newStatus: Task["status"]) => void;
	onPriorityChange: (taskId: string, newPriority: Task["priority"]) => void;
	onDelete: (taskId: string) => void;
	isLoading: boolean;
};

export function QueueSection({
	isMobile,
	tasks,
	onStatusChange,
	onPriorityChange,
	onDelete,
	isLoading,
}: QueueSectionProps) {
	const PAGE_SIZE = 8;
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
	const [queueAnnouncement, setQueueAnnouncement] = useState("");
	const [selectedType, setSelectedType] = useState<QueueFilterType>("all");
	const hasMountedRef = useRef(false);
	const lastAnnouncementRef = useRef("");
	const showLoadingState = isLoading && tasks.length === 0;

	const filteredTasks = useMemo(
		() => tasks.filter((task) => matchesFilterType(task, selectedType)),
		[tasks, selectedType],
	);

	useEffect(() => {
		setVisibleCount((current) => Math.min(current, Math.max(PAGE_SIZE, filteredTasks.length)));
	}, [filteredTasks.length]);

	const visibleTasks = useMemo(
		() => filteredTasks.slice(0, visibleCount),
		[filteredTasks, visibleCount],
	);

	useEffect(() => {
		if (showLoadingState) {
			setQueueAnnouncement("");
			return;
		}
		if (!hasMountedRef.current) {
			hasMountedRef.current = true;
			return;
		}
		const nextMessage =
			filteredTasks.length === 0
				? "Queue is empty."
				: `Queue updated. Showing ${visibleTasks.length} of ${filteredTasks.length} queued tasks.`;

		if (nextMessage === lastAnnouncementRef.current) {
			return;
		}

		const timeout = setTimeout(() => {
			lastAnnouncementRef.current = nextMessage;
			setQueueAnnouncement(nextMessage);
		}, 150);

		return () => clearTimeout(timeout);
	}, [showLoadingState, filteredTasks.length, visibleTasks.length]);

	const handleLoadMore = () => {
		setVisibleCount((current) => Math.min(filteredTasks.length, current + PAGE_SIZE));
	};

	return (
		<div style={{ marginBottom: "16px" }}>
			<SectionCard
				title="Next Up"
				countLabel={showLoadingState ? "Loading queue..." : `${filteredTasks.length} queued`}
			>
				<div role="status" aria-live="polite" aria-atomic="true" style={visuallyHiddenStyle}>
					{queueAnnouncement}
				</div>
				<div
					role="radiogroup"
					aria-label="Filter queue by task type"
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: "8px",
						marginBottom: "16px",
						padding: "8px",
						background: "var(--color-surface-secondary)",
						borderRadius: "8px",
					}}
				>
					{filterOptions.map((option) => (
						<label
							key={option.value}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: "4px",
								padding: "4px 8px",
								borderRadius: "4px",
								cursor: "pointer",
								fontSize: "13px",
								background:
									selectedType === option.value ? "var(--color-accent-primary)" : "transparent",
								color: selectedType === option.value ? "white" : "var(--color-text-primary)",
								transition: "background-color 0.15s ease",
							}}
						>
							<input
								type="radio"
								name="queue-type-filter"
								value={option.value}
								checked={selectedType === option.value}
								onChange={() => setSelectedType(option.value)}
								style={{ margin: 0 }}
							/>
							<span>{option.label}</span>
						</label>
					))}
				</div>
				{showLoadingState ? (
					<div style={{ padding: "24px 0", display: "flex", justifyContent: "center" }}>
						<LoadingSpinner message="Loading queue..." />
					</div>
				) : (
					<QueueList
						tasks={visibleTasks}
						onStatusChange={onStatusChange}
						onPriorityChange={onPriorityChange}
						onDelete={onDelete}
						remainingCount={filteredTasks.length - visibleTasks.length}
						onLoadMore={handleLoadMore}
						stacked={isMobile}
					/>
				)}
			</SectionCard>
		</div>
	);
}
