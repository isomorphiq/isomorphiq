import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CriticalPathService } from "../../../src/services/critical-path-service.ts";
import type { Task } from "../../../src/types.ts";
import { DependencyVisualization } from "./DependencyVisualization.tsx";
import { ImpactAnalysisComponent as ImpactAnalysis } from "./ImpactAnalysis.tsx";
import { Header, Layout } from "./Layout.tsx";
import { PriorityBadge } from "./PriorityBadge.tsx";
import { SectionCard } from "./SectionCard.tsx";
import { TypeBadge } from "./TypeBadge.tsx";

interface DependencyAnalysisPageProps {
	tasks: Task[];
}

export function DependencyAnalysisPage({ tasks }: DependencyAnalysisPageProps) {
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [activeView, setActiveView] = useState<"visualization" | "impact">("visualization");
	const [hoverInfo, setHoverInfo] = useState<{
		task: Task;
		top: number;
		left: number;
	} | null>(null);
	const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
	const availableListRef = useRef<HTMLDivElement | null>(null);

	// Calculate project statistics (memoized to reduce rerender cost)
	const projectStats = useMemo(() => CriticalPathService.calculateCriticalPath(tasks), [tasks]);
	const availableTasks = useMemo(() => CriticalPathService.getAvailableTasks(tasks), [tasks]);
	const blockingTasks = useMemo(() => CriticalPathService.getBlockingTasks(tasks), [tasks]);

	const selectedTask = tasks.find((t) => t.id === selectedTaskId);

	useEffect(() => {
		const handleResize = () => {
			const mobileView = window.innerWidth <= 768;
			setIsMobile(mobileView);
			if (mobileView) {
				setHoverInfo(null);
			}
		};

		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	const handleTaskClick = (task: Task) => {
		setSelectedTaskId(task.id === selectedTaskId ? null : task.id);
	};

	const handleAvailableTaskHover = (task: Task, event: MouseEvent<HTMLButtonElement>) => {
		if (isMobile) return;
		const containerRect = availableListRef.current?.getBoundingClientRect();
		if (!containerRect) return;

		const rect = event.currentTarget.getBoundingClientRect();
		const overlayWidth = 260;
		const desiredLeft = rect.right - containerRect.left + 12;
		const maxLeft = containerRect.width - overlayWidth - 12;
		const left = Math.max(12, Math.min(desiredLeft, maxLeft));
		const top = rect.top - containerRect.top - 4;

		setHoverInfo({ task, top, left });
	};

	const clearHoverInfo = () => setHoverInfo(null);

	return (
		<Layout>
			<Header
				title="Dependency Analysis"
				subtitle="Visualize task relationships and analyze critical paths"
				showAuthControls={false}
			/>

			{/* Navigation */}
			<div
				style={{
					display: "flex",
					gap: "12px",
					marginBottom: "16px",
					borderBottom: "1px solid #374151",
					paddingBottom: "12px",
				}}
			>
				<button
					type="button"
					onClick={() => setActiveView("visualization")}
					style={{
						padding: "8px 16px",
						border: "none",
						borderRadius: "6px",
						background: activeView === "visualization" ? "#3b82f6" : "#374151",
						color: "#f9fafb",
						fontSize: "14px",
						fontWeight: "500",
						cursor: "pointer",
					}}
				>
					Dependency Graph
				</button>
				<button
					type="button"
					onClick={() => setActiveView("impact")}
					style={{
						padding: "8px 16px",
						border: "none",
						borderRadius: "6px",
						background: activeView === "impact" ? "#3b82f6" : "#374151",
						color: "#f9fafb",
						fontSize: "14px",
						fontWeight: "500",
						cursor: "pointer",
					}}
				>
					Impact Analysis
				</button>
			</div>

			<div style={{ display: "grid", gap: "16px" }}>
				{/* Project Statistics */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
						gap: "12px",
						marginBottom: "16px",
					}}
				>
					<SectionCard title="Project Duration">
						<div
							style={{
								fontSize: "24px",
								fontWeight: "bold",
								color: "#3b82f6",
							}}
						>
							{projectStats.projectDuration.toFixed(1)} days
						</div>
					</SectionCard>

					<SectionCard title="Critical Tasks">
						<div
							style={{
								fontSize: "24px",
								fontWeight: "bold",
								color: "#ef4444",
							}}
						>
							{projectStats.criticalPath.length}
						</div>
					</SectionCard>

					<SectionCard title="Available Tasks">
						<div
							style={{
								fontSize: "24px",
								fontWeight: "bold",
								color: "#10b981",
							}}
						>
							{availableTasks.length}
						</div>
					</SectionCard>

					<SectionCard title="Blocking Tasks">
						<div
							style={{
								fontSize: "24px",
								fontWeight: "bold",
								color: "#f59e0b",
							}}
						>
							{blockingTasks.length}
						</div>
					</SectionCard>
				</div>

				{/* Main Content Area */}
				<div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "16px" }}>
					{/* Visualization or Impact Analysis */}
					<div>
						{activeView === "visualization" ? (
							<SectionCard title="Dependency Graph" countLabel={`${tasks.length} tasks`}>
								<div style={{ height: "600px" }}>
									<DependencyVisualization
										tasks={tasks}
										width={800}
										height={600}
										onTaskClick={handleTaskClick}
										selectedTaskId={selectedTaskId || undefined}
									/>
								</div>
							</SectionCard>
						) : (
							<SectionCard
								title="Impact Analysis"
								countLabel={selectedTask ? selectedTask.title : "No task selected"}
							>
								<ImpactAnalysis tasks={tasks} selectedTaskId={selectedTaskId || undefined} />
							</SectionCard>
						)}
					</div>

					{/* Sidebar */}
					<div>
						{/* Selected Task Details */}
						{selectedTask && (
							<SectionCard title="Selected Task">
								<div style={{ marginBottom: "12px" }}>
									<div
										style={{
											display: "flex",
											gap: "8px",
											marginBottom: "8px",
											alignItems: "center",
										}}
									>
										<TypeBadge type={selectedTask.type} />
										<PriorityBadge priority={selectedTask.priority} />
									</div>
									<h4
										style={{
											margin: "0 0 8px 0",
											color: "#f9fafb",
											fontSize: "16px",
										}}
									>
										{selectedTask.title}
									</h4>
									<p
										style={{
											margin: "0 0 12px 0",
											color: "#cbd5e1",
											fontSize: "14px",
											lineHeight: 1.4,
										}}
									>
										{selectedTask.description}
									</p>
								</div>

								<div style={{ fontSize: "12px", color: "#9ca3af" }}>
									<div style={{ marginBottom: "4px" }}>
										<strong>Status:</strong> {selectedTask.status}
									</div>
									<div style={{ marginBottom: "4px" }}>
										<strong>Created:</strong>{" "}
										{new Date(selectedTask.createdAt).toLocaleDateString()}
									</div>
									<div style={{ marginBottom: "4px" }}>
										<strong>Dependencies:</strong> {selectedTask.dependencies?.length || 0}
									</div>
									{selectedTask.assignedTo && (
										<div style={{ marginBottom: "4px" }}>
											<strong>Assigned to:</strong> {selectedTask.assignedTo}
										</div>
									)}
								</div>

								{projectStats.nodes.find((n) => n.id === selectedTask.id) && (
									<div
										style={{
											marginTop: "12px",
											padding: "8px",
											background: "#1f2937",
											borderRadius: "6px",
											fontSize: "12px",
										}}
									>
										<div style={{ color: "#9ca3af", marginBottom: "4px" }}>
											<strong>Critical Path Info:</strong>
										</div>
										{(() => {
											const node = projectStats.nodes.find((n) => n.id === selectedTask.id);
											if (!node) return null;
											return (
												<>
													<div style={{ color: "#cbd5e1", marginBottom: "2px" }}>
														Slack: {node.slack.toFixed(1)} days
													</div>
													<div style={{ color: "#cbd5e1", marginBottom: "2px" }}>
														Duration: {(node.earliestFinish - node.earliestStart).toFixed(1)} days
													</div>
													<div
														style={{
															color: node.isCritical ? "#ef4444" : "#10b981",
															fontWeight: "bold",
														}}
													>
														{node.isCritical ? "Critical Task" : "Non-Critical"}
													</div>
												</>
											);
										})()}
									</div>
								)}
							</SectionCard>
						)}

						{/* Quick Actions */}
						<SectionCard title="Quick Actions">
							<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
								<button
									type="button"
									onClick={() => setActiveView("impact")}
									disabled={!selectedTaskId}
									style={{
										padding: "8px 12px",
										border: "none",
										borderRadius: "6px",
										background: selectedTaskId ? "#3b82f6" : "#374151",
										color: "#f9fafb",
										fontSize: "12px",
										cursor: selectedTaskId ? "pointer" : "not-allowed",
									}}
								>
									Analyze Impact
								</button>
								<button
									type="button"
									onClick={() => setSelectedTaskId(null)}
									disabled={!selectedTaskId}
									style={{
										padding: "8px 12px",
										border: "none",
										borderRadius: "6px",
										background: selectedTaskId ? "#6b7280" : "#374151",
										color: "#f9fafb",
										fontSize: "12px",
										cursor: selectedTaskId ? "pointer" : "not-allowed",
									}}
								>
									Clear Selection
								</button>
							</div>
						</SectionCard>

						{/* Task Lists */}
						{availableTasks.length > 0 && (
							<SectionCard title={`Available Tasks (${availableTasks.length})`}>
								<section
									aria-label="Available tasks list"
									ref={availableListRef}
									style={{ position: "relative", maxHeight: "200px", overflowY: "auto" }}
									onMouseLeave={clearHoverInfo}
									onKeyDown={(e) => {
										if (e.key === "Escape") {
											clearHoverInfo();
										}
									}}
								>
									{availableTasks.map((task) => (
										<button
											type="button"
											key={task.id}
											onClick={() => setSelectedTaskId(task.id)}
											style={{
												padding: "6px 8px",
												borderRadius: "4px",
												cursor: "pointer",
												fontSize: "12px",
												color: "#cbd5e1",
												marginBottom: "4px",
												background: task.id === selectedTaskId ? "#1e40af" : "transparent",
											}}
											onMouseEnter={(event) => handleAvailableTaskHover(task, event)}
											onMouseLeave={clearHoverInfo}
										>
											{task.title}
										</button>
									))}
									{hoverInfo && (
										<div
											style={{
												position: "absolute",
												top: hoverInfo.top,
												left: hoverInfo.left,
												width: "260px",
												padding: "10px",
												borderRadius: "10px",
												background: "#0b1220",
												border: "1px solid #1f2937",
												boxShadow: "0 12px 40px rgba(0, 0, 0, 0.45)",
												pointerEvents: "none",
												zIndex: 10,
											}}
										>
											<div
												style={{
													display: "flex",
													gap: "8px",
													marginBottom: "6px",
													alignItems: "center",
												}}
											>
												<TypeBadge type={hoverInfo.task.type} />
												<PriorityBadge priority={hoverInfo.task.priority} />
											</div>
											<h4
												style={{
													margin: "0 0 4px 0",
													color: "#f9fafb",
													fontSize: "14px",
												}}
											>
												{hoverInfo.task.title}
											</h4>
											<div style={{ color: "#cbd5e1", fontSize: "12px" }}>
												Status: {hoverInfo.task.status}
											</div>
										</div>
									)}
								</section>
							</SectionCard>
						)}

						{blockingTasks.length > 0 && (
							<SectionCard title={`Blocking Tasks (${blockingTasks.length})`}>
								<div style={{ maxHeight: "200px", overflowY: "auto" }}>
									{blockingTasks.map((task) => (
										<button
											type="button"
											key={task.id}
											onClick={() => setSelectedTaskId(task.id)}
											style={{
												padding: "6px 8px",
												borderRadius: "4px",
												cursor: "pointer",
												fontSize: "12px",
												color: "#cbd5e1",
												marginBottom: "4px",
												background: task.id === selectedTaskId ? "#1e40af" : "transparent",
											}}
										>
											{task.title}
										</button>
									))}
								</div>
							</SectionCard>
						)}
					</div>
				</div>
			</div>
		</Layout>
	);
}
