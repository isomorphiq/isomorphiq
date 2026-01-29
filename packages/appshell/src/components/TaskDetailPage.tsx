import { useAtomValue, useSetAtom } from "jotai";
import type { CSSProperties } from "react";
import { useEffect, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Task } from "@isomorphiq/tasks/types";
import { queueAtom, refreshAtom, tasksAtom } from "../atoms.ts";
import { Header, Layout } from "./Layout";
import { PriorityBadge } from "./PriorityBadge";
import { SectionCard } from "./SectionCard";
import { TypeBadge } from "./TypeBadge";

const metaRowStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "120px 1fr",
	gap: "6px",
	alignItems: "center",
	fontSize: "13px",
};

function StatusPill({ status }: { status: Task["status"] }) {
	const colors: Record<Task["status"], string> = {
		todo: "#3b82f6",
		"in-progress": "#f59e0b",
		done: "#10b981",
	};
	const color = colors[status] ?? "#94a3b8";
	return (
		<span
			style={{
				display: "inline-block",
				padding: "4px 10px",
				borderRadius: "999px",
				border: `1px solid ${color}40`,
				background: `${color}1a`,
				color,
				fontWeight: 700,
				fontSize: "12px",
			}}
		>
			{status.replace("-", " ")}
		</span>
	);
}

export function TaskDetailPage() {
	const { taskId } = useParams();
	const navigate = useNavigate();
	const tasks = useAtomValue(tasksAtom) ?? [];
	const queue = useAtomValue(queueAtom) ?? [];
	const bumpRefresh = useSetAtom(refreshAtom);

	useEffect(() => {
		// Ensure we have fresh data when landing directly on the detail page.
		bumpRefresh((c) => c + 1);
	}, [bumpRefresh]);

	const task = useMemo(() => tasks.find((t) => t.id === taskId), [tasks, taskId]);

	const dependencyTasks = useMemo(
		() => tasks.filter((t) => (task?.dependencies ?? []).includes(t.id)),
		[tasks, task],
	);
	const dependents = useMemo(
		() => tasks.filter((t) => t.dependencies?.includes(task?.id ?? "")),
		[tasks, task],
	);
	const queueIndex = task ? queue.findIndex((t) => t.id === task.id) : -1;
    const actionLog = useMemo(() => {
        const entries = task?.actionLog ?? [];
        return [...entries].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    }, [task]);

	if (!task) {
		return (
			<Layout>
				<Header title="Task not found" subtitle="The requested task ID does not exist." />
				<nav style={{ marginBottom: "16px" }}>
					<Link to="/" style={{ color: "#93c5fd" }}>
						← Back to dashboard
					</Link>
				</nav>
				<SectionCard title="Missing task">
					<p style={{ color: "#cbd5e1" }}>We couldn’t find a task with ID “{taskId}”.</p>
					<button
						type="button"
						onClick={() => navigate(-1)}
						style={{
							marginTop: "8px",
							background: "#1f2937",
							color: "#e2e8f0",
							border: "1px solid #334155",
							borderRadius: "8px",
							padding: "8px 12px",
							cursor: "pointer",
						}}
					>
						Go back
					</button>
				</SectionCard>
			</Layout>
		);
	}

	const formatDateTime = (value: Date | string) => {
		const d = new Date(value);
		return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
	};

    const formatDuration = (durationMs: number) => {
        if (!Number.isFinite(durationMs) || durationMs < 0) {
            return "unknown";
        }
        if (durationMs < 1000) {
            return `${Math.round(durationMs)} ms`;
        }
        const totalSeconds = Math.round(durationMs / 1000);
        if (totalSeconds < 60) {
            return `${totalSeconds}s`;
        }
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
    };

	return (
		<Layout>
			<Header
				title={task.title}
				subtitle="Task details and relationships"
				showAuthControls={false}
			/>

			<nav
				style={{
					display: "flex",
					gap: "12px",
					marginBottom: "14px",
					alignItems: "center",
				}}
			>
				<Link to="/" style={{ color: "#93c5fd", textDecoration: "none" }}>
					← Back to dashboard
				</Link>
				<Link to="/workflow" style={{ color: "#cbd5e1", textDecoration: "none" }}>
					View workflow
				</Link>
			</nav>

			<div style={{ display: "grid", gap: "14px", gridTemplateColumns: "2fr 1fr" }}>
				<SectionCard title="Summary" countLabel={`ID ${task.id}`}>
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: "10px",
							marginBottom: "12px",
							alignItems: "center",
						}}
					>
						<TypeBadge type={task.type} />
						<PriorityBadge priority={task.priority} />
						<StatusPill status={task.status} />
					</div>
					<p style={{ color: "#e2e8f0", lineHeight: 1.6 }}>{task.description}</p>
				</SectionCard>

				<SectionCard title="Meta">
					<div style={{ display: "grid", gap: "8px" }}>
						<div style={metaRowStyle}>
							<span style={{ color: "#94a3b8" }}>Task ID</span>
							<code style={{ wordBreak: "break-all" }}>{task.id}</code>
						</div>
						<div style={metaRowStyle}>
							<span style={{ color: "#94a3b8" }}>Created</span>
							<span>{formatDateTime(task.createdAt)}</span>
						</div>
						<div style={metaRowStyle}>
							<span style={{ color: "#94a3b8" }}>Updated</span>
							<span>{formatDateTime(task.updatedAt)}</span>
						</div>
						<div style={metaRowStyle}>
							<span style={{ color: "#94a3b8" }}>Created by</span>
							<span>{task.createdBy || "unknown"}</span>
						</div>
						{task.assignedTo && (
							<div style={metaRowStyle}>
								<span style={{ color: "#94a3b8" }}>Assigned to</span>
								<span>{task.assignedTo}</span>
							</div>
						)}
						{task.collaborators?.length ? (
							<div style={metaRowStyle}>
								<span style={{ color: "#94a3b8" }}>Collaborators</span>
								<span>{task.collaborators.join(", ")}</span>
							</div>
						) : null}
						{task.watchers?.length ? (
							<div style={metaRowStyle}>
								<span style={{ color: "#94a3b8" }}>Watchers</span>
								<span>{task.watchers.join(", ")}</span>
							</div>
						) : null}
						{queueIndex >= 0 && (
							<div style={metaRowStyle}>
								<span style={{ color: "#94a3b8" }}>Queue position</span>
								<span>{queueIndex === 0 ? "Next up" : `#${queueIndex + 1} in queue`}</span>
							</div>
						)}
					</div>
				</SectionCard>
			</div>

			<div style={{ display: "grid", gap: "14px", gridTemplateColumns: "1fr 1fr" }}>
				<SectionCard title={`Dependencies (${task.dependencies?.length || 0})`}>
					{!task.dependencies?.length ? (
						<p style={{ color: "#94a3b8", margin: 0 }}>No dependencies.</p>
					) : (
						<ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "8px" }}>
							{task.dependencies.map((depId) => {
								const dep = dependencyTasks.find((t) => t.id === depId);
								return (
									<li
										key={depId}
										style={{
											padding: "10px",
											border: "1px solid #1f2937",
											borderRadius: "8px",
											background: "#0b1220",
										}}
									>
										<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
											<TypeBadge type={dep?.type ?? "task"} />
											<StatusPill status={dep?.status ?? "todo"} />
										</div>
										<div style={{ fontWeight: 700, marginTop: "4px", color: "#e2e8f0" }}>
											{dep?.title ?? "Unknown task"}
										</div>
										<div style={{ color: "#94a3b8", fontSize: "12px" }}>
											ID: <code style={{ wordBreak: "break-all" }}>{depId}</code>
										</div>
									</li>
								);
							})}
						</ul>
					)}
				</SectionCard>

				<SectionCard title={`Dependents (${dependents.length})`}>
					{!dependents.length ? (
						<p style={{ color: "#94a3b8", margin: 0 }}>Nothing depends on this task.</p>
					) : (
						<ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "8px" }}>
							{dependents.map((dep) => (
								<li
									key={dep.id}
									style={{
										padding: "10px",
										border: "1px solid #1f2937",
										borderRadius: "8px",
										background: "#0b1220",
									}}
								>
									<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
										<TypeBadge type={dep.type} />
										<StatusPill status={dep.status} />
									</div>
									<div style={{ fontWeight: 700, marginTop: "4px", color: "#e2e8f0" }}>
										{dep.title}
									</div>
									<div style={{ color: "#94a3b8", fontSize: "12px" }}>
										ID: <code style={{ wordBreak: "break-all" }}>{dep.id}</code>
									</div>
								</li>
							))}
						</ul>
					)}
				</SectionCard>
			</div>

            <SectionCard title={`Activity log (${actionLog.length})`}>
                {actionLog.length === 0 ? (
                    <p style={{ color: "#94a3b8", margin: 0 }}>
                        No activity has been recorded for this task yet.
                    </p>
                ) : (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "10px" }}>
                        {actionLog.map((entry) => {
                            const statusLabel = entry.success === false ? "Failed" : "Completed";
                            const statusColor = entry.success === false ? "#f97316" : "#10b981";
                            const summaryText = entry.summary?.trim() || "No summary provided.";
                            const transitionText = entry.transition?.trim() || "n/a";
                            const modelText = entry.modelName?.trim() || "unknown-model";
                            return (
                                <li
                                    key={entry.id}
                                    style={{
                                        padding: "12px",
                                        border: "1px solid #1f2937",
                                        borderRadius: "10px",
                                        background: "#0b1220",
                                        display: "grid",
                                        gap: "8px",
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: "8px",
                                        }}
                                    >
                                        <div style={{ fontWeight: 700, color: "#e2e8f0" }}>
                                            {entry.profile}
                                        </div>
                                        <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                                            {formatDuration(entry.durationMs)}
                                        </div>
                                    </div>
                                    <div style={{ color: "#e2e8f0", lineHeight: 1.5 }}>
                                        {summaryText}
                                    </div>
                                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                                        Transition: <code>{transitionText}</code>
                                    </div>
                                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                                        Model: <code>{modelText}</code>
                                    </div>
                                    {entry.prompt ? (
                                        <details style={{ fontSize: "12px", color: "#94a3b8" }}>
                                            <summary style={{ cursor: "pointer" }}>
                                                View prompt
                                            </summary>
                                            <pre
                                                style={{
                                                    marginTop: "8px",
                                                    whiteSpace: "pre-wrap",
                                                    background: "#0f172a",
                                                    border: "1px solid #1f2937",
                                                    borderRadius: "8px",
                                                    padding: "10px",
                                                    color: "#e2e8f0",
                                                    fontSize: "12px",
                                                }}
                                            >
                                                {entry.prompt}
                                            </pre>
                                        </details>
                                    ) : null}
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            fontSize: "12px",
                                            color: "#94a3b8",
                                        }}
                                    >
                                        <span>{formatDateTime(entry.createdAt)}</span>
                                        <span style={{ color: statusColor }}>{statusLabel}</span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </SectionCard>

			<SectionCard title="Raw payload">
				<pre
					style={{
						background: "#0b1220",
						border: "1px solid #1f2937",
						borderRadius: "10px",
						padding: "12px",
						color: "#e2e8f0",
						fontSize: "12px",
						overflowX: "auto",
					}}
				>
					{JSON.stringify(task, null, 2)}
				</pre>
			</SectionCard>
		</Layout>
	);
}
