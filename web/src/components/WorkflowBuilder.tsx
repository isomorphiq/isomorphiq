import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	WorkflowConnection,
	WorkflowDefinition,
	WorkflowNode,
	WorkflowNodeParameter,
	WorkflowNodePort,
	WorkflowNodeType,
} from "../../../src/types.ts";

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
}

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
	});
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

	// Update workflow when nodes or connections change
	useEffect(() => {
		const updatedWorkflow = {
			...workflow,
			nodes,
			connections,
		};
		onWorkflowChange(updatedWorkflow);
	}, [nodes, connections, workflow, onWorkflowChange]);

	// Handle node drag start
	const handleNodeMouseDown = useCallback(
		(e: React.MouseEvent, nodeId: string) => {
			if (readonly) return;

			e.preventDefault();
			e.stopPropagation();

			const node = nodes.find((n) => n.id === nodeId);
			if (!node) return;

			const rect = containerRef.current?.getBoundingClientRect();
			if (!rect) return;

			const mousePos = {
				x: (e.clientX - rect.left - pan.x) / scale,
				y: (e.clientY - rect.top - pan.y) / scale,
			};

			setDragState({
				isDragging: true,
				draggedNodeId: nodeId,
				dragOffset: {
					x: mousePos.x - node.position.x,
					y: mousePos.y - node.position.y,
				},
				mouseStart: mousePos,
			});

			setSelectedNode(nodeId);
			setSelectedConnection(null);
		},
		[nodes, pan, scale, readonly],
	);

	// Handle connection drag start
	const handlePortMouseDown = useCallback(
		(e: React.MouseEvent, nodeId: string, portId: string, isOutput: boolean) => {
			if (readonly) return;

			e.preventDefault();
			e.stopPropagation();

			if (isOutput) {
				setIsConnecting(true);
				setConnectionStart({ nodeId, portId });
			} else {
				// Start dragging from input port (for creating connections in reverse)
				setIsConnecting(true);
				setConnectionStart({ nodeId, portId });
			}
		},
		[readonly],
	);

	// Handle mouse move
	const handleMouseMove = useCallback(
		(e: React.MouseEvent) => {
			const rect = containerRef.current?.getBoundingClientRect();
			if (!rect) return;

			const mousePos = {
				x: (e.clientX - rect.left - pan.x) / scale,
				y: (e.clientY - rect.top - pan.y) / scale,
			};

			if (dragState.isDragging && dragState.draggedNodeId) {
				// Update node position
				setNodes((prevNodes) =>
					prevNodes.map((node) =>
						node.id === dragState.draggedNodeId
							? {
									...node,
									position: {
										x: mousePos.x - dragState.dragOffset.x,
										y: mousePos.y - dragState.dragOffset.y,
									},
								}
							: node,
					),
				);
			} else if (isPanning) {
				// Update pan
				const deltaX = e.clientX - lastPanPoint.x;
				const deltaY = e.clientY - lastPanPoint.y;
				setPan((prev) => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
				setLastPanPoint({ x: e.clientX, y: e.clientY });
			}
		},
		[dragState, isPanning, lastPanPoint, pan, scale],
	);

	// Handle mouse up
	const handleMouseUp = useCallback(
		(e: React.MouseEvent) => {
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
				dragOffset: { x: 0, y: 0 },
				mouseStart: { x: 0, y: 0 },
			});
			setIsConnecting(false);
			setConnectionStart(null);
			setIsPanning(false);
		},
		[isConnecting, connectionStart],
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
			const nodeWidth = 180;
			const nodeHeight = 80;

			return (
				<g
					key={node.id}
					transform={`translate(${node.position.x}, ${node.position.y})`}
					onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
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
						stroke={isSelected ? "#3b82f6" : "#e5e7eb"}
						strokeWidth={isSelected ? 3 : 1}
						opacity={0.9}
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
					{nodeTypeConfig.inputs?.map((port: WorkflowNodePort, _index: number) => (
						<circle
							key={`input-${port.id}`}
							cx={0}
							cy={nodeHeight / 2}
							r={8}
							fill="#3b82f6"
							stroke="white"
							strokeWidth={2}
							data-node-id={node.id}
							data-port-id={port.id}
							onMouseDown={(e) => handlePortMouseDown(e, node.id, port.id, false)}
							style={{ cursor: "crosshair" }}
						/>
					))}

					{/* Output ports */}
					{nodeTypeConfig.outputs?.map((port: WorkflowNodePort, _index: number) => (
						<circle
							key={`output-${port.id}`}
							cx={nodeWidth}
							cy={nodeHeight / 2}
							r={8}
							fill="#10b981"
							stroke="white"
							strokeWidth={2}
							data-node-id={node.id}
							data-port-id={port.id}
							onMouseDown={(e) => handlePortMouseDown(e, node.id, port.id, true)}
							style={{ cursor: "crosshair" }}
						/>
					))}
				</g>
			);
		},
		[selectedNode, getNodeTypeConfig, handleNodeMouseDown, handlePortMouseDown, readonly],
	);

	// Render connection
	const renderConnection = useCallback(
		(connection: WorkflowConnection) => {
			const sourceNode = nodes.find((n) => n.id === connection.sourceNodeId);
			const targetNode = nodes.find((n) => n.id === connection.targetNodeId);

			if (!sourceNode || !targetNode) return null;

			const sourceX = sourceNode.position.x + 180; // Node width
			const sourceY = sourceNode.position.y + 40; // Node height / 2
			const targetX = targetNode.position.x;
			const targetY = targetNode.position.y + 40;

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

						{/* Render nodes */}
						{nodes.map(renderNode)}

						{/* Connection preview */}
						{isConnecting && connectionStart && (
							<line
								x1={(nodes.find((n) => n.id === connectionStart.nodeId)?.position.x ?? 0) + 180}
								y1={(nodes.find((n) => n.id === connectionStart.nodeId)?.position.y ?? 0) + 40}
								x2={dragState.mouseStart.x}
								y2={dragState.mouseStart.y}
								stroke="#3b82f6"
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
