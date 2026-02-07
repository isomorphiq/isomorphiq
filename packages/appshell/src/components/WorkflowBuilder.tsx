// FILE_CONTEXT: "context-c47fbed1-b51f-4b3e-bd5c-c8a9d328bf7f"

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	WorkflowConnection,
	WorkflowDefinition,
	WorkflowNode,
	WorkflowNodeParameter,
	WorkflowNodePort,
	WorkflowNodeType,
} from "@isomorphiq/workflow/types";

export interface WorkflowNodeTypeConfig {
	type: WorkflowNodeType;
	label: string;
	description?: string;
	icon: string;
	color: string;
	inputs?: WorkflowNodePort[];
	outputs?: WorkflowNodePort[];
	parameters?: WorkflowNodeParameter[];
}

interface WorkflowBuilderProps {
	workflow: WorkflowDefinition;
	onWorkflowChange: (workflow: WorkflowDefinition) => void;
	nodeTypes: WorkflowNodeTypeConfig[];
	readonly?: boolean;
}

interface Position {
	x: number;
	y: number;
}

interface DragState {
	isDragging: boolean;
	draggedNodeId?: string;
	draggedConnectionId?: string;
	dragOffset: Position;
	mouseStart: Position;
	mouseCurrent: Position;
	dragOrigin?: Position;
}

type FeedbackState = "idle" | "hover" | "dragging" | "dropping";

const FEEDBACK_TIMING_MS = {
	hover: 320,
	drag: 340,
	drop: 360,
	ghost: 320,
};

const FEEDBACK_EASING = {
	hover: "cubic-bezier(0.22, 1, 0.36, 1)",
	drag: "cubic-bezier(0.34, 1.56, 0.64, 1)",
	drop: "cubic-bezier(0.16, 1, 0.3, 1)",
};

const DROP_INDICATOR_PADDING = 6;
const GHOST_OFFSET: Position = { x: 6, y: 6 };
const GHOST_OPACITY = 0.5;
const GHOST_SCALE = 0.9;
const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;
const NODE_HALF_HEIGHT = NODE_HEIGHT / 2;
const GHOST_SCALE_OFFSET: Position = {
	x: (NODE_WIDTH * (1 - GHOST_SCALE)) / 2,
	y: (NODE_HEIGHT * (1 - GHOST_SCALE)) / 2,
};
const DROP_HIGHLIGHT_COLOR = "#2563eb";

export const WorkflowBuilder: React.FC<WorkflowBuilderProps> = ({
	workflow,
	onWorkflowChange,
	nodeTypes,
	readonly = false,
}) => {
	const [nodes, setNodes] = useState<WorkflowNode[]>(workflow.nodes || []);
	const [connections, setConnections] = useState<WorkflowConnection[]>(workflow.connections || []);
	const [selectedNode, setSelectedNode] = useState<string | null>(null);
	const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
	const [dragState, setDragState] = useState<DragState>({
		isDragging: false,
		dragOffset: { x: 0, y: 0 },
		mouseStart: { x: 0, y: 0 },
		mouseCurrent: { x: 0, y: 0 },
		dragOrigin: undefined,
	});
	const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
	const [hoveredPort, setHoveredPort] = useState<{ nodeId: string; portId: string } | null>(null);
	const [dropIndicator, setDropIndicator] = useState<Position | null>(null);
	const [feedbackState, setFeedbackState] = useState<FeedbackState>("idle");
	const [lastDroppedNodeId, setLastDroppedNodeId] = useState<string | null>(null);
	const [isConnecting, setIsConnecting] = useState(false);
	const [connectionStart, setConnectionStart] = useState<{ nodeId: string; portId: string } | null>(
		null,
	);
	const [scale, setScale] = useState(1);
	const [pan, setPan] = useState<Position>({ x: 0, y: 0 });
	const [isPanning, setIsPanning] = useState(false);
	const [lastPanPoint, setLastPanPoint] = useState<Position>({ x: 0, y: 0 });

	const svgRef = useRef<SVGSVGElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (feedbackState !== "dropping") return;

		const timeout = setTimeout(() => {
			setFeedbackState("idle");
			setLastDroppedNodeId(null);
		}, FEEDBACK_TIMING_MS.drop);

		return () => clearTimeout(timeout);
	}, [feedbackState]);

	// Update workflow when nodes or connections change
	useEffect(() => {
		const updatedWorkflow = {
			...workflow,
			nodes,
			connections,
		};
		onWorkflowChange(updatedWorkflow);
	}, [nodes, connections, workflow, onWorkflowChange]);

	const getMousePosition = useCallback(
		(event: { clientX: number; clientY: number }) => {
			const rect = containerRef.current?.getBoundingClientRect();
			if (!rect) return null;

			return {
				x: (event.clientX - rect.left - pan.x) / scale,
				y: (event.clientY - rect.top - pan.y) / scale,
			};
		},
		[pan, scale],
	);

	// Handle node drag start
	const handleNodeMouseDown = useCallback(
		(e: React.MouseEvent, nodeId: string) => {
			if (readonly) return;

			e.preventDefault();
			e.stopPropagation();

			const node = nodes.find((n) => n.id === nodeId);
			if (!node) return;

			const mousePos = getMousePosition(e);
			if (!mousePos) return;

			setDragState({
				isDragging: true,
				draggedNodeId: nodeId,
				dragOffset: {
					x: mousePos.x - node.position.x,
					y: mousePos.y - node.position.y,
				},
				mouseStart: mousePos,
				mouseCurrent: mousePos,
				dragOrigin: { x: node.position.x, y: node.position.y },
			});
			setDropIndicator({ x: node.position.x, y: node.position.y });
			setFeedbackState("dragging");
			setLastDroppedNodeId(null);
			setHoveredNodeId(null);

			setSelectedNode(nodeId);
			setSelectedConnection(null);
		},
		[nodes, readonly, getMousePosition],
	);

	// Handle connection drag start
	const handlePortMouseDown = useCallback(
		(e: React.MouseEvent, nodeId: string, portId: string, _isOutput: boolean) => {
			if (readonly) return;

			e.preventDefault();
			e.stopPropagation();

			const mousePos = getMousePosition(e);
			if (!mousePos) return;

			// Start dragging from the port (output or input)
			setIsConnecting(true);
			setConnectionStart({ nodeId, portId });
			setDragState((prev) => ({
				...prev,
				mouseStart: mousePos,
				mouseCurrent: mousePos,
			}));
			setFeedbackState("dragging");
			setHoveredPort(null);
			setLastDroppedNodeId(null);
		},
		[readonly, getMousePosition],
	);

	const handleNodeHoverStart = useCallback(
		(nodeId: string) => {
			if (dragState.isDragging || isConnecting) return;
			setHoveredNodeId(nodeId);
			setFeedbackState("hover");
		},
		[dragState.isDragging, isConnecting],
	);

	const handleNodeHoverEnd = useCallback(() => {
		if (dragState.isDragging || isConnecting) return;
		setHoveredNodeId(null);
		setFeedbackState("idle");
	}, [dragState.isDragging, isConnecting]);

	const handlePortHoverStart = useCallback(
		(nodeId: string, portId: string) => {
			if (!isConnecting) return;
			setHoveredPort({ nodeId, portId });
		},
		[isConnecting],
	);

	const handlePortHoverEnd = useCallback(() => {
		if (!isConnecting) return;
		setHoveredPort(null);
	}, [isConnecting]);

	const cancelDrag = useCallback(() => {
		if (!dragState.isDragging && !isConnecting) return;

		if (dragState.isDragging && dragState.draggedNodeId && dragState.dragOrigin) {
			setNodes((prevNodes) =>
				prevNodes.map((node) =>
					node.id === dragState.draggedNodeId
						? {
								...node,
								position: {
									x: dragState.dragOrigin?.x ?? node.position.x,
									y: dragState.dragOrigin?.y ?? node.position.y,
								},
							}
						: node,
				),
			);
		}

		setDragState({
			isDragging: false,
			draggedNodeId: undefined,
			draggedConnectionId: undefined,
			dragOffset: { x: 0, y: 0 },
			mouseStart: { x: 0, y: 0 },
			mouseCurrent: { x: 0, y: 0 },
			dragOrigin: undefined,
		});
		setIsConnecting(false);
		setConnectionStart(null);
		setIsPanning(false);
		setDropIndicator(null);
		setHoveredPort(null);
		setHoveredNodeId(null);
		setFeedbackState("idle");
		setLastDroppedNodeId(null);
	}, [dragState, isConnecting]);

	useEffect(() => {
		if (!dragState.isDragging && !isConnecting) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			cancelDrag();
		};

		window.addEventListener("keydown", handleKeyDown);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [cancelDrag, dragState.isDragging, isConnecting]);

	// Handle mouse move
	const handleMouseMove = useCallback(
		(e: React.MouseEvent) => {
			const mousePos = getMousePosition(e);
			if (!mousePos) return;

			if (dragState.isDragging || isConnecting) {
				setDragState((prev) => ({
					...prev,
					mouseCurrent: mousePos,
				}));
			}

			if (dragState.isDragging && dragState.draggedNodeId) {
				// Update node position
				const nextPosition = {
					x: mousePos.x - dragState.dragOffset.x,
					y: mousePos.y - dragState.dragOffset.y,
				};

				setNodes((prevNodes) =>
					prevNodes.map((node) =>
						node.id === dragState.draggedNodeId
							? {
									...node,
									position: {
										x: nextPosition.x,
										y: nextPosition.y,
									},
								}
							: node,
					),
				);
				setDropIndicator(nextPosition);
			} else if (isPanning) {
				// Update pan
				const deltaX = e.clientX - lastPanPoint.x;
				const deltaY = e.clientY - lastPanPoint.y;
				setPan((prev) => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
				setLastPanPoint({ x: e.clientX, y: e.clientY });
			}
		},
		[dragState, isConnecting, isPanning, lastPanPoint, getMousePosition],
	);

	// Handle mouse up
	const handleMouseUp = useCallback(
		(e: React.MouseEvent) => {
			const wasDragging = dragState.isDragging || isConnecting;
			const droppedNodeId = dragState.draggedNodeId ?? null;
			const dropMousePosition =
				dragState.isDragging && dragState.draggedNodeId ? getMousePosition(e) : null;

			if (dropMousePosition && dragState.draggedNodeId) {
				const finalPosition = {
					x: dropMousePosition.x - dragState.dragOffset.x,
					y: dropMousePosition.y - dragState.dragOffset.y,
				};

				setNodes((prevNodes) =>
					prevNodes.map((node) =>
						node.id === dragState.draggedNodeId
							? {
									...node,
									position: {
										x: finalPosition.x,
										y: finalPosition.y,
									},
								}
							: node,
					),
				);
			}

			if (isConnecting && connectionStart) {
				// Check if we're over a port
				const portElement = (e.target as Element).closest("[data-port-id]");
				if (portElement) {
					const endNodeId = portElement.getAttribute("data-node-id");
					const endPortId = portElement.getAttribute("data-port-id");

					if (endNodeId && endPortId && endNodeId !== connectionStart.nodeId) {
						// Create connection
						const newConnection: WorkflowConnection = {
							id: `connection_${Date.now()}`,
							sourceNodeId: connectionStart.nodeId,
							sourcePortId: connectionStart.portId,
							targetNodeId: endNodeId,
							targetPortId: endPortId,
						};

						setConnections((prev) => [...prev, newConnection]);
					}
				}
			}

			setDragState({
				isDragging: false,
				draggedNodeId: undefined,
				draggedConnectionId: undefined,
				dragOffset: { x: 0, y: 0 },
				mouseStart: { x: 0, y: 0 },
				mouseCurrent: { x: 0, y: 0 },
				dragOrigin: undefined,
			});
			setIsConnecting(false);
			setConnectionStart(null);
			setIsPanning(false);
			setDropIndicator(null);
			setHoveredPort(null);

			if (wasDragging) {
				setFeedbackState("dropping");
				setLastDroppedNodeId(droppedNodeId);
			}
		},
		[connectionStart, dragState, getMousePosition, isConnecting],
	);

	// Handle canvas pan start
	const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
		if (
			e.target === svgRef.current ||
			(e.target as Element).classList.contains("workflow-canvas")
		) {
			setIsPanning(true);
			setLastPanPoint({ x: e.clientX, y: e.clientY });
		}
	}, []);

	// Handle wheel zoom
	const handleWheel = useCallback(
		(e: React.WheelEvent) => {
			e.preventDefault();

			const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
			const newScale = Math.min(Math.max(scale * scaleFactor, 0.1), 3);

			setScale(newScale);
		},
		[scale],
	);

	// Add node to workflow
	const addNode = useCallback(
		(nodeType: WorkflowNodeType, position: Position) => {
			if (readonly) return;

			const nodeTypeConfig = nodeTypes.find((nt) => nt.type === nodeType);
			if (!nodeTypeConfig) return;

			const newNode: WorkflowNode = {
				id: `node_${Date.now()}`,
				type: nodeType,
				position,
				data: {},
				config: {
					inputs: nodeTypeConfig.inputs || [],
					outputs: nodeTypeConfig.outputs || [],
					parameters: nodeTypeConfig.parameters || [],
				},
			};

			setNodes((prev) => [...prev, newNode]);
		},
		[nodeTypes, readonly],
	);

	// Delete node
	const deleteNode = useCallback(
		(nodeId: string) => {
			if (readonly) return;

			setNodes((prev) => prev.filter((n) => n.id !== nodeId));
			setConnections((prev) =>
				prev.filter((c) => c.sourceNodeId !== nodeId && c.targetNodeId !== nodeId),
			);
			setSelectedNode(null);
		},
		[readonly],
	);

	// Delete connection
	const deleteConnection = useCallback(
		(connectionId: string) => {
			if (readonly) return;

			setConnections((prev) => prev.filter((c) => c.id !== connectionId));
			setSelectedConnection(null);
		},
		[readonly],
	);

	// Get node type configuration
	const getNodeTypeConfig = useCallback(
		(nodeType: WorkflowNodeType) => {
			return nodeTypes.find((nt) => nt.type === nodeType);
		},
		[nodeTypes],
	);

	// Render node
	const renderNode = useCallback(
		(node: WorkflowNode) => {
			const nodeTypeConfig = getNodeTypeConfig(node.type);
			if (!nodeTypeConfig) return null;

			const isSelected = selectedNode === node.id;
			const isHovered = hoveredNodeId === node.id;
			const isDraggingNode = dragState.isDragging && dragState.draggedNodeId === node.id;
			const isDroppingNode = feedbackState === "dropping" && lastDroppedNodeId === node.id;
			const isDropTarget = isConnecting && hoveredPort?.nodeId === node.id;
			const nodeWidth = NODE_WIDTH;
			const nodeHeight = NODE_HEIGHT;
			const transitionMs = isDraggingNode
				? FEEDBACK_TIMING_MS.drag
				: feedbackState === "dropping"
					? FEEDBACK_TIMING_MS.drop
					: FEEDBACK_TIMING_MS.hover;
			const transitionEasing = isDraggingNode
				? FEEDBACK_EASING.drag
				: feedbackState === "dropping"
					? FEEDBACK_EASING.drop
					: FEEDBACK_EASING.hover;
			const transition = `${transitionMs}ms ${transitionEasing}`;
			const nodeStroke = isDraggingNode
				? "#2563eb"
				: isDroppingNode
					? "#22c55e"
					: isDropTarget
						? "#22c55e"
						: isHovered
							? "#38bdf8"
							: isSelected
								? "#3b82f6"
								: "#e5e7eb";
			const nodeStrokeWidth = isDraggingNode
				? 4
				: isDroppingNode
					? 4
					: isDropTarget
						? 3
						: isSelected
							? 3
							: isHovered
								? 2
								: 1;
			const nodeOpacity = dragState.isDragging && !isDraggingNode ? 0.6 : 0.9;
			const nodeFilter = isDraggingNode
				? "drop-shadow(0 8px 14px rgba(37,99,235,0.35))"
				: isDroppingNode
					? "drop-shadow(0 0 14px rgba(34,197,94,0.55))"
					: isHovered
						? "drop-shadow(0 6px 12px rgba(56,189,248,0.35))"
						: "none";

			return (
				<g
					key={node.id}
					transform={`translate(${node.position.x}, ${node.position.y})`}
					onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
					onMouseEnter={() => handleNodeHoverStart(node.id)}
					onMouseLeave={handleNodeHoverEnd}
					style={{ cursor: readonly ? "default" : "move" }}
					role="button"
					tabIndex={0}
					aria-label={`Node: ${nodeTypeConfig.label}`}
				>
					{/* Node background */}
					<rect
						width={nodeWidth}
						height={nodeHeight}
						rx={8}
						fill={nodeTypeConfig.color}
						stroke={nodeStroke}
						strokeWidth={nodeStrokeWidth}
						opacity={nodeOpacity}
						style={{
							filter: nodeFilter,
							transition: `opacity ${transition}, stroke ${transition}, stroke-width ${transition}, filter ${transition}`,
						}}
					/>

					{/* Node icon */}
					<text x={15} y={25} fill="white" fontSize="20" fontFamily="Arial">
						{nodeTypeConfig.icon}
					</text>

					{/* Node label */}
					<text
						x={nodeWidth / 2}
						y={nodeHeight / 2 + 5}
						fill="white"
						fontSize="14"
						fontWeight="bold"
						textAnchor="middle"
						fontFamily="Arial"
					>
						{nodeTypeConfig.label}
					</text>

					{/* Input ports */}
					{nodeTypeConfig.inputs?.map((port: WorkflowNodePort, _index: number) => {
						const isPortHovered =
							isConnecting &&
							hoveredPort?.nodeId === node.id &&
							hoveredPort?.portId === port.id;
						const portTransition = `${FEEDBACK_TIMING_MS.hover}ms ${FEEDBACK_EASING.hover}`;
						return (
							<circle
								key={`input-${port.id}`}
								cx={0}
								cy={nodeHeight / 2}
								r={isPortHovered ? 10 : 8}
								fill={isPortHovered ? "#22c55e" : "#3b82f6"}
								stroke={isPortHovered ? "#f0fdf4" : "white"}
								strokeWidth={2}
								data-node-id={node.id}
								data-port-id={port.id}
								onMouseDown={(e) => handlePortMouseDown(e, node.id, port.id, false)}
								onMouseEnter={() => handlePortHoverStart(node.id, port.id)}
								onMouseLeave={handlePortHoverEnd}
								style={{
									cursor: "crosshair",
									filter: isPortHovered
										? "drop-shadow(0 0 10px rgba(34,197,94,0.6))"
										: "none",
									transition: `r ${portTransition}, fill ${portTransition}, stroke ${portTransition}, filter ${portTransition}`,
								}}
							/>
						);
					})}

					{/* Output ports */}
					{nodeTypeConfig.outputs?.map((port: WorkflowNodePort, _index: number) => {
						const isPortHovered =
							isConnecting &&
							hoveredPort?.nodeId === node.id &&
							hoveredPort?.portId === port.id;
						const portTransition = `${FEEDBACK_TIMING_MS.hover}ms ${FEEDBACK_EASING.hover}`;
						return (
							<circle
								key={`output-${port.id}`}
								cx={nodeWidth}
								cy={nodeHeight / 2}
								r={isPortHovered ? 10 : 8}
								fill={isPortHovered ? "#22c55e" : "#10b981"}
								stroke={isPortHovered ? "#f0fdf4" : "white"}
								strokeWidth={2}
								data-node-id={node.id}
								data-port-id={port.id}
								onMouseDown={(e) => handlePortMouseDown(e, node.id, port.id, true)}
								onMouseEnter={() => handlePortHoverStart(node.id, port.id)}
								onMouseLeave={handlePortHoverEnd}
								style={{
									cursor: "crosshair",
									filter: isPortHovered
										? "drop-shadow(0 0 10px rgba(34,197,94,0.6))"
										: "none",
									transition: `r ${portTransition}, fill ${portTransition}, stroke ${portTransition}, filter ${portTransition}`,
								}}
							/>
						);
					})}
				</g>
			);
		},
		[
			dragState,
			feedbackState,
			getNodeTypeConfig,
			handleNodeHoverEnd,
			handleNodeHoverStart,
			handleNodeMouseDown,
			handlePortHoverEnd,
			handlePortHoverStart,
			handlePortMouseDown,
			hoveredNodeId,
			hoveredPort,
			isConnecting,
			lastDroppedNodeId,
			readonly,
			selectedNode,
		],
	);

	// Render connection
	const renderConnection = useCallback(
		(connection: WorkflowConnection) => {
			const sourceNode = nodes.find((n) => n.id === connection.sourceNodeId);
			const targetNode = nodes.find((n) => n.id === connection.targetNodeId);

			if (!sourceNode || !targetNode) return null;

			const sourceX = sourceNode.position.x + NODE_WIDTH;
			const sourceY = sourceNode.position.y + NODE_HALF_HEIGHT;
			const targetX = targetNode.position.x;
			const targetY = targetNode.position.y + NODE_HALF_HEIGHT;

			const isSelected = selectedConnection === connection.id;

			// Create curved path
			const midX = (sourceX + targetX) / 2;
			const path = `M ${sourceX} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX} ${targetY}`;

			return (
				<g key={connection.id}>
					<path
						d={path}
						stroke={isSelected ? "#3b82f6" : "#6b7280"}
						strokeWidth={isSelected ? 3 : 2}
						fill="none"
						onMouseDown={() => {
							if (!readonly) {
								setSelectedConnection(connection.id);
								setSelectedNode(null);
							}
						}}
						style={{ cursor: readonly ? "default" : "pointer" }}
					/>
					{/* Arrow marker */}
					<defs>
						<marker
							id={`arrow-${connection.id}`}
							viewBox="0 0 10 10"
							refX="9"
							refY="3"
							markerWidth="6"
							markerHeight="6"
							orient="auto"
						>
							<path d="M0,0 L0,6 L9,3 z" fill="#6b7280" />
						</marker>
					</defs>
				</g>
			);
		},
		[nodes, selectedConnection, readonly],
	);

	const draggedNode = dragState.draggedNodeId
		? nodes.find((node) => node.id === dragState.draggedNodeId)
		: null;
	const draggedNodeConfig = draggedNode ? getNodeTypeConfig(draggedNode.type) : null;
	const dropPreviewPosition = dragState.isDragging && dropIndicator ? dropIndicator : null;
	const ghostPosition = dropPreviewPosition
		? { x: dropPreviewPosition.x + GHOST_OFFSET.x, y: dropPreviewPosition.y + GHOST_OFFSET.y }
		: null;
	const dropIndicatorTransition = `${FEEDBACK_TIMING_MS.drag}ms ${FEEDBACK_EASING.drag}`;
	const ghostTransition = `${FEEDBACK_TIMING_MS.ghost}ms ${FEEDBACK_EASING.hover}`;
	const connectionPreviewColor = hoveredPort ? "#22c55e" : "#3b82f6";

	return (
		<div
			className="workflow-builder"
			style={{ width: "100%", height: "100%", position: "relative" }}
		>
			{/* Toolbar */}
			<div
				className="workflow-toolbar"
				style={{
					position: "absolute",
					top: 10,
					left: 10,
					zIndex: 1000,
					background: "white",
					border: "1px solid #e5e7eb",
					borderRadius: 8,
					padding: 10,
					boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
				}}
			>
				<div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
					{nodeTypes.map((nodeType) => (
						<button
							key={nodeType.type}
							type="button"
							onClick={() => addNode(nodeType.type, { x: 200, y: 200 })}
							disabled={readonly}
							style={{
								padding: "8px 12px",
								border: "1px solid #e5e7eb",
								borderRadius: 4,
								background: "white",
								cursor: readonly ? "not-allowed" : "pointer",
								fontSize: "12px",
							}}
							title={nodeType.description}
						>
							{nodeType.icon} {nodeType.label}
						</button>
					))}
				</div>

				{/* Zoom controls */}
				<div style={{ display: "flex", gap: 5, alignItems: "center" }}>
					<button
						type="button"
						onClick={() => setScale(Math.min(scale * 1.2, 3))}
						style={{ padding: "4px 8px", border: "1px solid #e5e7eb", borderRadius: 4 }}
					>
						+
					</button>
					<span style={{ fontSize: "12px" }}>{Math.round(scale * 100)}%</span>
					<button
						type="button"
						onClick={() => setScale(Math.max(scale * 0.8, 0.1))}
						style={{ padding: "4px 8px", border: "1px solid #e5e7eb", borderRadius: 4 }}
					>
						-
					</button>
					<button
						type="button"
						onClick={() => {
							setScale(1);
							setPan({ x: 0, y: 0 });
						}}
						style={{ padding: "4px 8px", border: "1px solid #e5e7eb", borderRadius: 4 }}
					>
						Reset
					</button>
				</div>
			</div>

			{/* Canvas */}
			<div
				ref={containerRef}
				className="workflow-canvas"
				role="application"
				aria-label="Workflow canvas"
				style={{
					width: "100%",
					height: "100%",
					background: "#f9fafb",
					backgroundImage: "radial-gradient(circle, #e5e7eb 1px, transparent 1px)",
					backgroundSize: "20px 20px",
					overflow: "hidden",
					cursor: isPanning ? "grabbing" : "grab",
				}}
				onWheel={handleWheel}
				onMouseDown={handleCanvasMouseDown}
				onMouseMove={handleMouseMove}
				onMouseUp={handleMouseUp}
			>
				<svg
					ref={svgRef}
					width="100%"
					height="100%"
					style={{ position: "absolute", top: 0, left: 0 }}
					role="img"
					aria-label="Workflow canvas"
				>
					<title>Workflow Canvas</title>
					{/* Apply pan and zoom transformations */}
					<g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
						{/* Render connections */}
						{connections.map(renderConnection)}

						{/* Drop zone indicator */}
						{dragState.isDragging && dropPreviewPosition && draggedNodeConfig && (
							<rect
								x={dropPreviewPosition.x - DROP_INDICATOR_PADDING}
								y={dropPreviewPosition.y - DROP_INDICATOR_PADDING}
								width={NODE_WIDTH + DROP_INDICATOR_PADDING * 2}
								height={NODE_HEIGHT + DROP_INDICATOR_PADDING * 2}
								rx={12}
								fill="rgba(37,99,235,0.12)"
								stroke={DROP_HIGHLIGHT_COLOR}
								strokeWidth={2}
								strokeDasharray="6,4"
								opacity={0.9}
								pointerEvents="none"
								style={{
									transition: `opacity ${dropIndicatorTransition}, stroke ${dropIndicatorTransition}, fill ${dropIndicatorTransition}`,
								}}
							/>
						)}

						{/* Ghost preview */}
						{dragState.isDragging &&
							draggedNode &&
							draggedNodeConfig &&
							dropPreviewPosition &&
							ghostPosition && (
								<g
									transform={`translate(${ghostPosition.x + GHOST_SCALE_OFFSET.x}, ${ghostPosition.y + GHOST_SCALE_OFFSET.y}) scale(${GHOST_SCALE})`}
									opacity={GHOST_OPACITY}
									pointerEvents="none"
								>
									<rect
										width={NODE_WIDTH}
										height={NODE_HEIGHT}
										rx={8}
										fill={draggedNodeConfig.color}
										stroke="#93c5fd"
										strokeWidth={2}
										strokeDasharray="5,4"
										style={{
											transition: `opacity ${ghostTransition}`,
										}}
									/>
									<text
										x={15}
										y={25}
										fill="white"
										fontSize="20"
										fontFamily="Arial"
									>
										{draggedNodeConfig.icon}
									</text>
									<text
										x={NODE_WIDTH / 2}
										y={NODE_HALF_HEIGHT + 5}
										fill="white"
										fontSize="14"
										fontWeight="bold"
										textAnchor="middle"
										fontFamily="Arial"
									>
										{draggedNodeConfig.label}
									</text>
								</g>
							)}

						{/* Render nodes */}
						{nodes.map(renderNode)}

						{/* Connection preview */}
						{isConnecting && connectionStart && (
							<line
								x1={
									(nodes.find((n) => n.id === connectionStart.nodeId)?.position.x ?? 0) +
									NODE_WIDTH
								}
								y1={
									(nodes.find((n) => n.id === connectionStart.nodeId)?.position.y ?? 0) +
									NODE_HALF_HEIGHT
								}
								x2={dragState.mouseCurrent.x}
								y2={dragState.mouseCurrent.y}
								stroke={connectionPreviewColor}
								strokeWidth={2}
								strokeDasharray="5,5"
								pointerEvents="none"
							/>
						)}
					</g>
				</svg>
			</div>

			{/* Delete button for selected items */}
			{!readonly && (selectedNode || selectedConnection) && (
				<div
					style={{
						position: "absolute",
						bottom: 20,
						right: 20,
						zIndex: 1000,
					}}
				>
					<button
						type="button"
						onClick={() => {
							if (selectedNode) {
								deleteNode(selectedNode);
							} else if (selectedConnection) {
								deleteConnection(selectedConnection);
							}
						}}
						style={{
							padding: "10px 20px",
							background: "#ef4444",
							color: "white",
							border: "none",
							borderRadius: 6,
							cursor: "pointer",
							fontWeight: "bold",
						}}
					>
						Delete {selectedNode ? "Node" : "Connection"}
					</button>
				</div>
			)}
		</div>
	);
};
