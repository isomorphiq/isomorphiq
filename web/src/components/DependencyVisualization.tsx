import * as d3 from "d3";
import { useEffect, useRef, useState } from "react";
import {
	type CriticalPathResult,
	CriticalPathService,
	type DependencyLink,
	type TaskNode,
} from "../../../src/services/critical-path-service.ts";
import type { Task } from "../../../src/types.ts";

interface DependencyVisualizationProps {
	tasks: Task[];
	width?: number;
	height?: number;
	onTaskClick?: (task: Task) => void;
	onTaskHover?: (task: Task | null) => void;
	selectedTaskId?: string;
}

interface ZoomState {
	scale: number;
	translateX: number;
	translateY: number;
}

export function DependencyVisualization({
	tasks,
	width = 1200,
	height = 600,
	onTaskClick,
	onTaskHover,
	selectedTaskId,
}: DependencyVisualizationProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	const [criticalPathResult, setCriticalPathResult] = useState<CriticalPathResult | null>(null);
	const [zoomState, setZoomState] = useState<ZoomState>({ scale: 1, translateX: 0, translateY: 0 });
	const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);

	// Calculate critical path when tasks change
	useEffect(() => {
		if (tasks.length === 0) return;

		try {
			const result = CriticalPathService.calculateCriticalPath(tasks);
			setCriticalPathResult(result);
		} catch (error) {
			console.error("Error calculating critical path:", error);
		}
	}, [tasks]);

	// Render the visualization
	useEffect(() => {
		if (!svgRef.current || !criticalPathResult) return;

		const svg = d3.select(svgRef.current);
		svg.selectAll("*").remove(); // Clear previous content

		// Create zoom behavior
		const zoom = d3
			.zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.1, 4])
			.on("zoom", (event) => {
				const { transform } = event;
				setZoomState({
					scale: transform.k,
					translateX: transform.x,
					translateY: transform.y,
				});

				g.attr("transform", transform);
			});

		svg.call(zoom);

		// Create main group
		const g = svg.append("g");

		// Create arrow marker for dependency links
		svg
			.append("defs")
			.append("marker")
			.attr("id", "arrowhead")
			.attr("viewBox", "0 -5 10 10")
			.attr("refX", 25)
			.attr("refY", 0)
			.attr("markerWidth", 6)
			.attr("markerHeight", 6)
			.attr("orient", "auto")
			.append("path")
			.attr("d", "M0,-5L10,0L0,5")
			.attr("fill", "#6b7280");

		svg
			.append("defs")
			.append("marker")
			.attr("id", "arrowhead-critical")
			.attr("viewBox", "0 -5 10 10")
			.attr("refX", 25)
			.attr("refY", 0)
			.attr("markerWidth", 6)
			.attr("markerHeight", 6)
			.attr("orient", "auto")
			.append("path")
			.attr("d", "M0,-5L10,0L0,5")
			.attr("fill", "#ef4444");

		// Draw dependency links
		const linkGroup = g.append("g").attr("class", "links");

		const _links = linkGroup
			.selectAll(".link")
			.data(criticalPathResult.links)
			.enter()
			.append("line")
			.attr("class", "link")
			.attr("x1", (d: DependencyLink) => {
				const sourceNode = criticalPathResult.nodes.find((n: TaskNode) => n.id === d.source);
				return sourceNode ? sourceNode.x : 0;
			})
			.attr("y1", (d: DependencyLink) => {
				const sourceNode = criticalPathResult.nodes.find((n: TaskNode) => n.id === d.source);
				return sourceNode ? sourceNode.y : 0;
			})
			.attr("x2", (d: DependencyLink) => {
				const targetNode = criticalPathResult.nodes.find((n: TaskNode) => n.id === d.target);
				return targetNode ? targetNode.x : 0;
			})
			.attr("y2", (d: DependencyLink) => {
				const targetNode = criticalPathResult.nodes.find((n: TaskNode) => n.id === d.target);
				return targetNode ? targetNode.y : 0;
			})
			.attr("stroke", (d: DependencyLink) => (d.isCritical ? "#ef4444" : "#6b7280"))
			.attr("stroke-width", (d: DependencyLink) => (d.isCritical ? 3 : 2))
			.attr("stroke-dasharray", (d: DependencyLink) => (d.isCritical ? "0" : "5,5"))
			.attr(
				"marker-end",
				(d: DependencyLink) => `url(#${d.isCritical ? "arrowhead-critical" : "arrowhead"})`,
			)
			.attr("opacity", 0.7);

		// Draw task nodes
		const nodeGroup = g.append("g").attr("class", "nodes");

		const nodes = nodeGroup
			.selectAll(".node")
			.data(criticalPathResult.nodes)
			.enter()
			.append("g")
			.attr("class", "node")
			.attr("transform", (d: TaskNode) => `translate(${d.x}, ${d.y})`)
			.style("cursor", "pointer")
			.on("click", (event: MouseEvent, d: TaskNode) => {
				event.stopPropagation();
				onTaskClick?.(d.task);
			})
			.on("mouseenter", (_event: MouseEvent, d: TaskNode) => {
				setHoveredTaskId(d.id);
				onTaskHover?.(d.task);
			})
			.on("mouseleave", () => {
				setHoveredTaskId(null);
				onTaskHover?.(null);
			});

		// Add node backgrounds
		nodes
			.append("rect")
			.attr("x", -60)
			.attr("y", -25)
			.attr("width", 120)
			.attr("height", 50)
			.attr("rx", 8)
			.attr("fill", (d: TaskNode) => {
				if (d.id === selectedTaskId) return "#3b82f6";
				if (d.id === hoveredTaskId) return "#1f2937";
				if (d.isCritical) return "#dc2626";
				return "#374151";
			})
			.attr("stroke", (d: TaskNode) => {
				if (d.id === selectedTaskId) return "#60a5fa";
				if (d.isCritical) return "#f87171";
				return "#6b7280";
			})
			.attr("stroke-width", (d: TaskNode) => (d.id === selectedTaskId ? 3 : 2));

		// Add task titles
		nodes
			.append("text")
			.attr("text-anchor", "middle")
			.attr("dominant-baseline", "middle")
			.attr("fill", "#f9fafb")
			.attr("font-size", "12px")
			.attr("font-weight", "600")
			.attr("max-width", 100)
			.text((d: TaskNode) => {
				const title = d.task.title;
				return title.length > 15 ? `${title.substring(0, 12)}...` : title;
			});

		// Add status indicators
		nodes
			.append("circle")
			.attr("cx", 45)
			.attr("cy", -15)
			.attr("r", 6)
			.attr("fill", (d: TaskNode) => {
				switch (d.task.status) {
					case "done":
						return "#10b981";
					case "in-progress":
						return "#f59e0b";
					case "todo":
						return "#3b82f6";
					default:
						return "#6b7280";
				}
			});

		// Add priority indicators
		nodes
			.append("text")
			.attr("x", 45)
			.attr("y", -15)
			.attr("text-anchor", "middle")
			.attr("dominant-baseline", "middle")
			.attr("fill", "#ffffff")
			.attr("font-size", "8px")
			.attr("font-weight", "bold")
			.text((d: TaskNode) => d.task.priority.charAt(0).toUpperCase());

		// Add tooltips
		nodes.append("title").text((d: TaskNode) => {
			const task = d.task;
			const slackInfo = d.slack > 0.1 ? ` (Slack: ${d.slack.toFixed(1)} days)` : " (Critical)";
			return `${task.title}\\nStatus: ${task.status}\\nPriority: ${task.priority}\\nDuration: ${(d.earliestFinish - d.earliestStart).toFixed(1)} days${slackInfo}`;
		});

		// Add level labels
		const levelGroups = d3.group(criticalPathResult.nodes, (d: TaskNode) => d.level);

		levelGroups.forEach((nodesInLevel, level) => {
			const firstNode = nodesInLevel[0];
			if (firstNode) {
				g.append("text")
					.attr("x", 50)
					.attr("y", firstNode.y)
					.attr("fill", "#9ca3af")
					.attr("font-size", "11px")
					.attr("font-weight", "600")
					.text(`Level ${level}`);
			}
		});

		// Add critical path highlight
		if (criticalPathResult.criticalPath.length > 0) {
			const criticalPathNodes = criticalPathResult.nodes.filter((n: TaskNode) =>
				criticalPathResult.criticalPath.includes(n.id),
			);

			// Create a path that follows the critical path
			const criticalPathLine = d3
				.line<TaskNode>()
				.x((d: TaskNode) => d.x)
				.y((d: TaskNode) => d.y)
				.curve(d3.curveMonotoneX);

			g.append("path")
				.datum(criticalPathNodes)
				.attr("class", "critical-path-highlight")
				.attr("d", criticalPathLine)
				.attr("fill", "none")
				.attr("stroke", "#ef4444")
				.attr("stroke-width", 8)
				.attr("stroke-opacity", 0.2)
				.attr("stroke-linecap", "round");
		}
	}, [criticalPathResult, selectedTaskId, hoveredTaskId, onTaskClick, onTaskHover]);

	if (!criticalPathResult) {
		return (
			<div
				style={{
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
					height: "400px",
					color: "#9ca3af",
				}}
			>
				Loading dependency visualization...
			</div>
		);
	}

	return (
		<div style={{ position: "relative", width: "100%", height: "100%" }}>
			{/* Controls */}
			<div
				style={{
					position: "absolute",
					top: "10px",
					right: "10px",
					background: "#1f2937",
					border: "1px solid #374151",
					borderRadius: "8px",
					padding: "8px",
					zIndex: 10,
				}}
			>
				<div style={{ color: "#f9fafb", fontSize: "12px", marginBottom: "4px" }}>
					Zoom: {(zoomState.scale * 100).toFixed(0)}%
				</div>
				<div style={{ color: "#9ca3af", fontSize: "11px" }}>
					Use mouse wheel to zoom, drag to pan
				</div>
			</div>

			{/* Legend */}
			<div
				style={{
					position: "absolute",
					bottom: "10px",
					left: "10px",
					background: "#1f2937",
					border: "1px solid #374151",
					borderRadius: "8px",
					padding: "8px",
					zIndex: 10,
				}}
			>
				<div style={{ color: "#f9fafb", fontSize: "12px", fontWeight: "600", marginBottom: "4px" }}>
					Legend
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
					<div
						style={{
							width: "12px",
							height: "12px",
							backgroundColor: "#dc2626",
							borderRadius: "2px",
						}}
					></div>
					<span style={{ color: "#9ca3af", fontSize: "11px" }}>Critical Path</span>
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
					<div
						style={{
							width: "12px",
							height: "12px",
							backgroundColor: "#374151",
							borderRadius: "2px",
						}}
					></div>
					<span style={{ color: "#9ca3af", fontSize: "11px" }}>Regular Task</span>
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
					<div
						style={{
							width: "12px",
							height: "12px",
							backgroundColor: "#10b981",
							borderRadius: "50%",
						}}
					></div>
					<span style={{ color: "#9ca3af", fontSize: "11px" }}>Done</span>
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					<div
						style={{
							width: "12px",
							height: "12px",
							backgroundColor: "#f59e0b",
							borderRadius: "50%",
						}}
					></div>
					<span style={{ color: "#9ca3af", fontSize: "11px" }}>In Progress</span>
				</div>
			</div>

			{/* Stats */}
			<div
				style={{
					position: "absolute",
					top: "10px",
					left: "10px",
					background: "#1f2937",
					border: "1px solid #374151",
					borderRadius: "8px",
					padding: "8px",
					zIndex: 10,
				}}
			>
				<div style={{ color: "#f9fafb", fontSize: "12px", fontWeight: "600", marginBottom: "4px" }}>
					Project Stats
				</div>
				<div style={{ color: "#9ca3af", fontSize: "11px", marginBottom: "2px" }}>
					Duration: {criticalPathResult.projectDuration.toFixed(1)} days
				</div>
				<div style={{ color: "#9ca3af", fontSize: "11px", marginBottom: "2px" }}>
					Critical Tasks: {criticalPathResult.criticalPath.length}
				</div>
				<div style={{ color: "#9ca3af", fontSize: "11px" }}>
					Total Tasks: {criticalPathResult.nodes.length}
				</div>
			</div>

			{/* SVG Canvas */}
			<svg
				ref={svgRef}
				width={width}
				height={height}
				style={{
					border: "1px solid #374151",
					borderRadius: "8px",
					background: "#0b1220",
					cursor: "grab",
				}}
				onMouseDown={(e) => {
					e.currentTarget.style.cursor = "grabbing";
				}}
				onMouseUp={(e) => {
					e.currentTarget.style.cursor = "grab";
				}}
			/>
		</div>
	);
}
