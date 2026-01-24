import { useState } from "react";
import { CriticalPathService, type ImpactAnalysis as ImpactAnalysisResult } from "@isomorphiq/service-critical-path";
import type { Task } from "@isomorphiq/tasks";

interface ImpactAnalysisProps {
	tasks: Task[];
	selectedTaskId?: string;
}

export function ImpactAnalysisComponent({ tasks, selectedTaskId }: ImpactAnalysisProps) {
	const [delayDays, setDelayDays] = useState(1);
	const [impact, setImpact] = useState<ImpactAnalysisResult | null>(null);
	const [isAnalyzing, setIsAnalyzing] = useState(false);

	const analyzeImpact = async () => {
		if (!selectedTaskId) return;

		setIsAnalyzing(true);
		try {
			const result = CriticalPathService.analyzeDelayImpact(tasks, selectedTaskId, delayDays);
			setImpact(result);
		} catch (error) {
			console.error("Error analyzing impact:", error);
		} finally {
			setIsAnalyzing(false);
		}
	};

	const selectedTask = tasks.find((t) => t.id === selectedTaskId);

	if (!selectedTask) {
		return (
			<div
				style={{
					padding: "20px",
					textAlign: "center",
					color: "#9ca3af",
				}}
			>
				Select a task to analyze impact
			</div>
		);
	}

	return (
		<div style={{ padding: "16px" }}>
			<h3
				style={{
					margin: "0 0 16px 0",
					color: "#f9fafb",
					fontSize: "18px",
				}}
			>
				Impact Analysis: {selectedTask.title}
			</h3>

			{/* Analysis Controls */}
			<div
				style={{
					background: "#1f2937",
					border: "1px solid #374151",
					borderRadius: "8px",
					padding: "16px",
					marginBottom: "16px",
				}}
			>
				<div style={{ marginBottom: "12px" }}>
					<label
						htmlFor="delay-duration"
						style={{
							display: "block",
							color: "#e5e7eb",
							marginBottom: "4px",
							fontSize: "14px",
						}}
					>
						Delay Duration (days):
					</label>
					<input
						id="delay-duration"
						type="number"
						min="0.5"
						max="30"
						step="0.5"
						value={delayDays}
						onChange={(e) => setDelayDays(parseFloat(e.target.value) || 1)}
						style={{
							width: "100%",
							padding: "8px 12px",
							border: "1px solid #4b5563",
							borderRadius: "6px",
							background: "#374151",
							color: "#f9fafb",
							fontSize: "14px",
						}}
					/>
				</div>

				<button
					type="button"
					onClick={analyzeImpact}
					disabled={isAnalyzing}
					style={{
						padding: "10px 16px",
						border: "none",
						borderRadius: "6px",
						background: isAnalyzing ? "#6b7280" : "#3b82f6",
						color: "white",
						fontSize: "14px",
						fontWeight: "500",
						cursor: isAnalyzing ? "not-allowed" : "pointer",
						width: "100%",
					}}
				>
					{isAnalyzing ? "Analyzing..." : "Analyze Impact"}
				</button>
			</div>

			{/* Impact Results */}
			{impact && (
				<div
					style={{
						background: "#1f2937",
						border: "1px solid #374151",
						borderRadius: "8px",
						padding: "16px",
						marginBottom: "16px",
					}}
				>
					<h4
						style={{
							margin: "0 0 12px 0",
							color: "#f9fafb",
							fontSize: "16px",
						}}
					>
						Impact Results
					</h4>

					{/* Summary */}
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
							gap: "12px",
							marginBottom: "16px",
						}}
					>
						<div
							style={{
								background: impact.criticalPathImpact ? "#dc2626" : "#059669",
								borderRadius: "6px",
								padding: "12px",
								textAlign: "center",
							}}
						>
							<div
								style={{
									color: "#ffffff",
									fontSize: "12px",
									marginBottom: "4px",
								}}
							>
								Critical Path Impact
							</div>
							<div
								style={{
									color: "#ffffff",
									fontSize: "16px",
									fontWeight: "bold",
								}}
							>
								{impact.criticalPathImpact ? "YES" : "NO"}
							</div>
						</div>

						<div
							style={{
								background: "#1f2937",
								border: "1px solid #4b5563",
								borderRadius: "6px",
								padding: "12px",
								textAlign: "center",
							}}
						>
							<div
								style={{
									color: "#9ca3af",
									fontSize: "12px",
									marginBottom: "4px",
								}}
							>
								Affected Tasks
							</div>
							<div
								style={{
									color: "#f9fafb",
									fontSize: "16px",
									fontWeight: "bold",
								}}
							>
								{impact.affectedTasks.length}
							</div>
						</div>

						<div
							style={{
								background: "#1f2937",
								border: "1px solid #4b5563",
								borderRadius: "6px",
								padding: "12px",
								textAlign: "center",
							}}
						>
							<div
								style={{
									color: "#9ca3af",
									fontSize: "12px",
									marginBottom: "4px",
								}}
							>
								Project Delay
							</div>
							<div
								style={{
									color: impact.criticalPathImpact ? "#ef4444" : "#10b981",
									fontSize: "16px",
									fontWeight: "bold",
								}}
							>
								{impact.criticalPathImpact ? `+${impact.delayDays} days` : "No delay"}
							</div>
						</div>
					</div>

					{/* Affected Tasks List */}
					{impact.affectedTasks.length > 0 && (
						<div>
							<h5
								style={{
									margin: "0 0 8px 0",
									color: "#e5e7eb",
									fontSize: "14px",
								}}
							>
								Affected Tasks ({impact.affectedTasks.length})
							</h5>
							<div
								style={{
									maxHeight: "200px",
									overflowY: "auto",
									border: "1px solid #4b5563",
									borderRadius: "6px",
									background: "#111827",
								}}
							>
								{impact.delayedTasks.map((delayedTask) => {
									const task = tasks.find((t) => t.id === delayedTask.taskId);
									if (!task) return null;

									return (
										<div
											key={delayedTask.taskId}
											style={{
												padding: "8px 12px",
												borderBottom: "1px solid #374151",
												display: "flex",
												justifyContent: "space-between",
												alignItems: "center",
											}}
										>
											<div style={{ flex: 1 }}>
												<div
													style={{
														color: "#f9fafb",
														fontSize: "13px",
														fontWeight: "500",
													}}
												>
													{task.title}
												</div>
												<div
													style={{
														color: "#9ca3af",
														fontSize: "11px",
														fontFamily: "monospace",
													}}
												>
													{delayedTask.taskId}
												</div>
											</div>
											<div
												style={{
													textAlign: "right",
													color: delayedTask.delayDays > 0 ? "#ef4444" : "#10b981",
													fontSize: "12px",
													fontWeight: "600",
												}}
											>
												{delayedTask.delayDays > 0 ? `+${delayedTask.delayDays}d` : "No delay"}
											</div>
										</div>
									);
								})}
							</div>
						</div>
					)}

					{impact.affectedTasks.length === 0 && (
						<div
							style={{
								textAlign: "center",
								color: "#9ca3af",
								fontSize: "14px",
								padding: "20px",
								border: "1px solid #4b5563",
								borderRadius: "6px",
								background: "#111827",
							}}
						>
							No tasks are affected by this delay
						</div>
					)}
				</div>
			)}

			{/* Recommendations */}
			{impact && (
				<div
					style={{
						background: "#1f2937",
						border: "1px solid #374151",
						borderRadius: "8px",
						padding: "16px",
					}}
				>
					<h4
						style={{
							margin: "0 0 12px 0",
							color: "#f9fafb",
							fontSize: "16px",
						}}
					>
						Recommendations
					</h4>
					<div style={{ color: "#e5e7eb", fontSize: "14px", lineHeight: 1.6 }}>
						{impact.criticalPathImpact ? (
							<div style={{ color: "#f87171" }}>
								<p>⚠️ This delay will impact the project timeline</p>
								<p>📅 Consider adding resources to reduce delay</p>
								<p>🔄 Look for tasks that can be fast-tracked</p>
								<p>📢 Notify stakeholders about timeline impact</p>
							</div>
						) : (
							<div style={{ color: "#10b981" }}>
								<p>✅ This delay will not impact the project timeline</p>
								<p>🎯 Focus on completing critical path tasks first</p>
								<p>📊 Monitor task progress closely</p>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
