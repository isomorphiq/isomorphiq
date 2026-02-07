// FILE_CONTEXT: "context-bc5c6aef-bfc3-41e7-9aca-9ca8ab81d24f"

import type { Task } from "@isomorphiq/tasks/types";
import { useAtomValue, useSetAtom } from "jotai";
import type { CSSProperties } from "react";
import { useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useNavigate, useParams } from "react-router-dom";
import remarkGfm from "remark-gfm";
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

type QaCommandResultView = {
	label: string;
	command: string;
	status: string;
	exitCode: string;
	errorMessage: string;
	stdout: string;
	stderr: string;
};

type QaReportView = {
	transition: string;
	stage: string;
	status: string;
	summary: string;
	output: string;
	testReport: {
		failedTests: string[];
		reproSteps: string[];
		suspectedRootCause: string;
		notes: string;
	};
	commandResults: QaCommandResultView[];
	coverageReport: {
		output: string;
		commandResults: QaCommandResultView[];
	} | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const readStringArray = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const readQaCommandResults = (value: unknown): QaCommandResultView[] =>
	Array.isArray(value)
		? value
				.filter((entry): entry is Record<string, unknown> => isRecord(entry))
				.map((entry) => ({
					label: typeof entry.label === "string" ? entry.label : "unknown",
					command: typeof entry.command === "string" ? entry.command : "",
					status: typeof entry.status === "string" ? entry.status : "UNKNOWN",
					exitCode:
						typeof entry.exitCode === "number" || typeof entry.exitCode === "string"
							? String(entry.exitCode)
							: "n/a",
					errorMessage: typeof entry.errorMessage === "string" ? entry.errorMessage : "",
					stdout: typeof entry.stdout === "string" ? entry.stdout : "",
					stderr: typeof entry.stderr === "string" ? entry.stderr : "",
				}))
		: [];

const readQaReport = (value: unknown): QaReportView | null => {
	if (!isRecord(value)) {
		return null;
	}
	const testReportRecord = isRecord(value.testReport) ? value.testReport : {};
	const coverageRecord = isRecord(value.coverageReport) ? value.coverageReport : null;
	return {
		transition: typeof value.transition === "string" ? value.transition : "",
		stage: typeof value.stage === "string" ? value.stage : "",
		status: typeof value.status === "string" ? value.status : "",
		summary: typeof value.summary === "string" ? value.summary : "",
		output: typeof value.output === "string" ? value.output : "",
		testReport: {
			failedTests: readStringArray(testReportRecord.failedTests),
			reproSteps: readStringArray(testReportRecord.reproSteps),
			suspectedRootCause:
				typeof testReportRecord.suspectedRootCause === "string"
					? testReportRecord.suspectedRootCause
					: "",
			notes: typeof testReportRecord.notes === "string" ? testReportRecord.notes : "",
		},
		commandResults: readQaCommandResults(value.commandResults),
		coverageReport: coverageRecord
			? {
					output: typeof coverageRecord.output === "string" ? coverageRecord.output : "",
					commandResults: readQaCommandResults(coverageRecord.commandResults),
				}
			: null,
	};
};

function StatusPill({ status }: { status: Task["status"] }) {
	const colors: Record<Task["status"], string> = {
		todo: "#3b82f6",
		"in-progress": "#f59e0b",
		done: "#10b981",
		invalid: "#ef4444",
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
					<Link to="/overview" style={{ color: "#93c5fd" }}>
						← Back to overview
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
				<Link to="/overview" style={{ color: "#93c5fd", textDecoration: "none" }}>
					← Back to overview
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
					<div
						style={{
							color: "#e2e8f0",
							lineHeight: 1.6,
						}}
					>
						<ReactMarkdown
							remarkPlugins={[remarkGfm]}
							components={{
								p: ({ children }) => (
									<p style={{ margin: "0 0 12px 0", lineHeight: 1.6 }}>{children}</p>
								),
								h1: ({ children }) => (
									<h1 style={{ margin: "16px 0 12px 0", fontSize: "20px", fontWeight: 700 }}>
										{children}
									</h1>
								),
								h2: ({ children }) => (
									<h2 style={{ margin: "14px 0 10px 0", fontSize: "18px", fontWeight: 600 }}>
										{children}
									</h2>
								),
								h3: ({ children }) => (
									<h3 style={{ margin: "12px 0 8px 0", fontSize: "16px", fontWeight: 600 }}>
										{children}
									</h3>
								),
								ul: ({ children }) => (
									<ul style={{ margin: "8px 0", paddingLeft: "20px" }}>{children}</ul>
								),
								ol: ({ children }) => (
									<ol style={{ margin: "8px 0", paddingLeft: "20px" }}>{children}</ol>
								),
								li: ({ children }) => <li style={{ margin: "4px 0" }}>{children}</li>,
								code: ({ children }) => (
									<code
										style={{
											background: "#1f2937",
											padding: "2px 6px",
											borderRadius: "4px",
											fontFamily:
												"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
											fontSize: "13px",
										}}
									>
										{children}
									</code>
								),
								pre: ({ children }) => (
									<pre
										style={{
											background: "#0f172a",
											padding: "12px",
											borderRadius: "8px",
											overflow: "auto",
											fontFamily:
												"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
											fontSize: "13px",
											margin: "12px 0",
										}}
									>
										{children}
									</pre>
								),
								a: ({ children, href }) => (
									<a href={href} style={{ color: "#93c5fd", textDecoration: "underline" }}>
										{children}
									</a>
								),
								blockquote: ({ children }) => (
									<blockquote
										style={{
											borderLeft: "4px solid #3b82f6",
											margin: "12px 0",
											paddingLeft: "16px",
											color: "#94a3b8",
										}}
									>
										{children}
									</blockquote>
								),
							}}
						>
							{task.description}
						</ReactMarkdown>
					</div>
					{typeof task.prd === "string" && task.prd.trim().length > 0 ? (
						<details style={{ marginTop: "14px" }}>
							<summary
								style={{
									cursor: "pointer",
									color: "#93c5fd",
									fontWeight: 600,
									marginBottom: "8px",
								}}
							>
								Product Requirements Document
							</summary>
							<pre
								style={{
									margin: 0,
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
									fontSize: "12px",
									lineHeight: 1.5,
									color: "#cbd5e1",
									background: "#0f172a",
									border: "1px solid #334155",
									borderRadius: "10px",
									padding: "12px",
									maxHeight: "420px",
									overflow: "auto",
								}}
							>
								{task.prd}
							</pre>
						</details>
					) : null}
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
							const entryRecord = entry as unknown as Record<string, unknown>;
							const qaReport = readQaReport(entryRecord.qaReport);
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
										<div style={{ fontWeight: 700, color: "#e2e8f0" }}>{entry.profile}</div>
										<div style={{ fontSize: "12px", color: "#94a3b8" }}>
											{formatDuration(entry.durationMs)}
										</div>
									</div>
									<div style={{ color: "#e2e8f0", lineHeight: 1.5 }}>{summaryText}</div>
									<div style={{ fontSize: "12px", color: "#94a3b8" }}>
										Transition: <code>{transitionText}</code>
									</div>
									<div style={{ fontSize: "12px", color: "#94a3b8" }}>
										Model: <code>{modelText}</code>
									</div>
									{entry.prompt ? (
										<details style={{ fontSize: "12px", color: "#94a3b8" }}>
											<summary style={{ cursor: "pointer" }}>View prompt</summary>
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
									{qaReport ? (
										<details style={{ fontSize: "12px", color: "#94a3b8" }}>
											<summary style={{ cursor: "pointer" }}>View QA report</summary>
											<div style={{ marginTop: "8px", display: "grid", gap: "8px" }}>
												<div>
													Status: <code>{qaReport.status || "unknown"}</code>
													{qaReport.stage ? (
														<>
															{" "}
															| Stage: <code>{qaReport.stage}</code>
														</>
													) : null}
												</div>
												{qaReport.testReport.failedTests.length > 0 ? (
													<div>Failed tests: {qaReport.testReport.failedTests.join(" | ")}</div>
												) : null}
												{qaReport.testReport.reproSteps.length > 0 ? (
													<div>Repro steps: {qaReport.testReport.reproSteps.join(" | ")}</div>
												) : null}
												{qaReport.testReport.suspectedRootCause ? (
													<div>Root cause: {qaReport.testReport.suspectedRootCause}</div>
												) : null}
												{qaReport.testReport.notes ? (
													<pre
														style={{
															margin: 0,
															whiteSpace: "pre-wrap",
															background: "#0f172a",
															border: "1px solid #1f2937",
															borderRadius: "8px",
															padding: "10px",
															color: "#e2e8f0",
															fontSize: "12px",
														}}
													>
														{qaReport.testReport.notes}
													</pre>
												) : null}
												{qaReport.coverageReport ? (
													<details>
														<summary style={{ cursor: "pointer" }}>Coverage report</summary>
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
															{qaReport.coverageReport.output}
														</pre>
													</details>
												) : null}
												{qaReport.commandResults.length > 0 ? (
													<details>
														<summary style={{ cursor: "pointer" }}>
															Command results ({qaReport.commandResults.length})
														</summary>
														<div style={{ marginTop: "8px", display: "grid", gap: "8px" }}>
															{qaReport.commandResults.map((result, index) => (
																<div
																	key={`${result.label}-${String(index)}`}
																	style={{
																		border: "1px solid #1f2937",
																		borderRadius: "8px",
																		padding: "8px",
																		background: "#0f172a",
																		display: "grid",
																		gap: "6px",
																	}}
																>
																	<div>
																		<code>{result.label}</code> <span>{result.status}</span>{" "}
																		<span>(exit: {result.exitCode})</span>
																	</div>
																	<div>
																		Command: <code>{result.command}</code>
																	</div>
																	{result.errorMessage ? (
																		<div>Error: {result.errorMessage}</div>
																	) : null}
																	{result.stdout ? (
																		<pre
																			style={{
																				margin: 0,
																				whiteSpace: "pre-wrap",
																				color: "#e2e8f0",
																			}}
																		>
																			{result.stdout}
																		</pre>
																	) : null}
																	{result.stderr ? (
																		<pre
																			style={{
																				margin: 0,
																				whiteSpace: "pre-wrap",
																				color: "#fca5a5",
																			}}
																		>
																			{result.stderr}
																		</pre>
																	) : null}
																</div>
															))}
														</div>
													</details>
												) : null}
												{qaReport.output ? (
													<details>
														<summary style={{ cursor: "pointer" }}>Raw QA output</summary>
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
															{qaReport.output}
														</pre>
													</details>
												) : null}
											</div>
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
