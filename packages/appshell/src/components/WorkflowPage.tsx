// FILE_CONTEXT: "context-b620541c-2d8b-4f24-ad31-548d17397c2f"

import * as d3 from "d3";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { workflowGraph } from "@isomorphiq/workflow/workflow-graph";
import { Header, Layout } from "./Layout";
import { SectionCard } from "./SectionCard";

type NodeDatum = {
	id: string;
	group: string;
	palette: NodePalette;
	x?: number;
	y?: number;
};

type LinkDatum = {
	source: string | NodeDatum;
	target: string | NodeDatum;
	label: string;
	offset?: number;
};

type D3NodeDatum = NodeDatum & {
	x: number;
	y: number;
};

type D3LinkDatum = {
	source: D3NodeDatum;
	target: D3NodeDatum;
	label: string;
	offset?: number;
};

type NodePalette = {
	fill: string;
	highlight: string;
	shadow: string;
	stroke: string;
	text: string;
};

const nodeColorSeeds: Record<string, string> = {
	"themes-proposed": "#bae6fd",
	"themes-prioritized": "#0ea5e9",
	"initiatives-proposed": "#6ee7b7",
	"initiatives-prioritized": "#34d399",
	"new-feature-proposed": "#c084fc",
	"features-prioritized": "#8b5cf6",
	"stories-created": "#fb7185",
	"stories-prioritized": "#f472b6",
	"tasks-prepared": "#f59e0b",
	"task-in-progress": "#3b82f6",
	"lint-completed": "#facc15",
	"typecheck-completed": "#fbbf24",
	"unit-tests-completed": "#f59e0b",
	"e2e-tests-completed": "#f97316",
	"coverage-completed": "#fb7185",
	"task-completed": "#22c55e",
};

const fallbackNodeSeed = "#94a3b8";

const clampChannel = (value: number) =>
	Math.min(255, Math.max(0, Math.round(value)));

const toHex = (value: number) => value.toString(16).padStart(2, "0");

const hexToRgb = (hex: string) => {
	const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
	const expanded =
		normalized.length === 3
			? normalized
					.split("")
					.map((ch) => ch + ch)
					.join("")
			: normalized;
	const r = parseInt(expanded.slice(0, 2), 16);
	const g = parseInt(expanded.slice(2, 4), 16);
	const b = parseInt(expanded.slice(4, 6), 16);
	return { r, g, b };
};

const shadeHex = (hex: string, delta: number) => {
	const { r, g, b } = hexToRgb(hex);
	const nr = clampChannel(r + delta);
	const ng = clampChannel(g + delta);
	const nb = clampChannel(b + delta);
	return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
};

const relativeLuminance = (hex: string) => {
	const { r, g, b } = hexToRgb(hex);
	const sr = r / 255;
	const sg = g / 255;
	const sb = b / 255;
	return 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
};

const pickTextColor = (hex: string) =>
	relativeLuminance(hex) > 0.62 ? "#0b1220" : "#f8fafc";

const buildNodePalette = (hex: string): NodePalette => ({
	fill: hex,
	highlight: shadeHex(hex, 26),
	shadow: shadeHex(hex, -22),
	stroke: shadeHex(hex, -36),
	text: pickTextColor(hex),
});

export function WorkflowPage() {
	const svgRef = useRef<SVGSVGElement | null>(null);
	const svgSelectionRef = useRef<d3.Selection<
		SVGSVGElement,
		unknown,
		null,
		undefined
	> | null>(null);
	const zoomBehaviorRef = useRef<d3.ZoomBehavior<
		SVGSVGElement,
		unknown
	> | null>(null);
	const bodyOverflowRef = useRef<string>("");
	const [isFullscreen, setIsFullscreen] = useState(false);
	// Expose zoom helpers to buttons rendered outside the SVG.
	const controlsRef = useRef<{
		zoomIn?: () => void;
		zoomOut?: () => void;
		reset?: () => void;
		fit?: () => void;
	}>({});

	useEffect(() => {
		if (!svgRef.current) return;
		const width = 960;
		const height = 540;
		const nodeData = workflowGraph.nodes.map((node) => {
			const seed = nodeColorSeeds[node.id] ?? fallbackNodeSeed;
			return { ...node, palette: buildNodePalette(seed) };
		});
		const linkData = workflowGraph.links.map((link) => ({ ...link }));

		// Offset only genuine bidirectional pairs so their curves don’t overlap (our “Pauli exclusion”).
		const grouped = new Map<string, LinkDatum[]>();
		const toNodeId = (value: string | NodeDatum) =>
			typeof value === "string" ? value : value.id;
		const normKey = (a: string | NodeDatum, b: string | NodeDatum) => {
			return [toNodeId(a), toNodeId(b)].sort().join("__");
		};
		linkData.forEach((l) => {
			const key = normKey(l.source, l.target);
			if (!grouped.has(key)) grouped.set(key, []);
			grouped.get(key)?.push(l);
		});
		grouped.forEach((arr) => {
			if (arr.length === 2) {
				const offset = 46;
				for (const lnk of arr) {
					const sourceId = toNodeId(lnk.source);
					const targetId = toNodeId(lnk.target);
					const isLower = sourceId < targetId;
					lnk.offset = isLower ? offset : -offset;
				}
			} else {
				for (const lnk of arr) {
					lnk.offset = 0;
				}
			}
		});

		// Root SVG with a card-like background.
		const svg = d3
			.select(svgRef.current)
			.attr("viewBox", `0 0 ${width} ${height}`)
			.style("background", "#ffffff")
			.style("borderRadius", "14px")
			.style("boxShadow", "0 18px 44px rgba(15, 23, 42, 0.12)");
		svgSelectionRef.current = svg;

		svg.selectAll("*").remove();

		const defs = svg.append("defs");

		const gradients = defs.append("g").attr("id", "node-gradients");
		nodeData.forEach((node) => {
			const gradient = gradients
				.append("radialGradient")
				.attr("id", `node-grad-${node.id}`)
				.attr("cx", "30%")
				.attr("cy", "30%")
				.attr("r", "75%");
			gradient
				.append("stop")
				.attr("offset", "0%")
				.attr("stop-color", node.palette.highlight);
			gradient
				.append("stop")
				.attr("offset", "70%")
				.attr("stop-color", node.palette.fill);
			gradient
				.append("stop")
				.attr("offset", "100%")
				.attr("stop-color", node.palette.shadow);
		});

		// Soft grid to keep layout readable while zooming.
		defs
			.append("pattern")
			.attr("id", "grid")
			.attr("width", 36)
			.attr("height", 36)
			.attr("patternUnits", "userSpaceOnUse")
			.append("path")
			.attr("d", "M36 0H0V36")
			.attr("fill", "none")
			.attr("stroke", "#e2e8f0")
			.attr("stroke-width", 1.1);

		// Arrowhead definition; marker is sized generously so it stays crisp when scaled.
		defs
			.append("marker")
			.attr("id", "arrow")
			.attr("viewBox", "0 -5 10 10")
			.attr("refX", 5)
			.attr("refY", 0)
			.attr("markerWidth", 22)
			.attr("markerHeight", 22)
			.attr("markerUnits", "userSpaceOnUse")
			.attr("orient", "auto")
			.append("path")
			.attr("d", "M0,-5L10,0L0,5")
			.attr("fill", "#cbd5e1");

		// Subtle depth on nodes.
		const nodeShadow = defs
			.append("filter")
			.attr("id", "node-shadow")
			.attr("height", "140%");
		nodeShadow
			.append("feDropShadow")
			.attr("dx", 0)
			.attr("dy", 8)
			.attr("stdDeviation", 8)
			.attr("flood-color", "#0f172a")
			.attr("flood-opacity", 0.16);

		svg
			.append("rect")
			.attr("width", width)
			.attr("height", height)
			.attr("fill", "url(#grid)");

		const zoomGroup = svg.append("g").attr("class", "zoom-layer");

		// Force layout tuned for fast “shake then settle” behavior.
		const sim = d3
			.forceSimulation<NodeDatum>(nodeData)
			.force(
				"link",
				d3
					.forceLink<NodeDatum, LinkDatum>(linkData)
					.id((d) => d.id)
					.distance(170),
			)
			.force("charge", d3.forceManyBody().strength(-980))
			.force("center", d3.forceCenter(width / 2, height / 2))
			.force("collision", d3.forceCollide(78));

		// Zoom/pan on the outer svg; all content lives in zoomGroup.
		const zoomBehavior = d3
			.zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.35, 2.8])
			.on("zoom", (event) => {
				zoomGroup.attr("transform", event.transform);
			});
		zoomBehaviorRef.current = zoomBehavior;
		svg.call(zoomBehavior);

		// Curved links with thick light-gray strokes; arrows are added via marker.
		const link = zoomGroup
			.append("g")
			.attr("stroke", "#cbd5e1")
			.attr("fill", "none")
			.attr("stroke-linecap", "round")
			.attr("stroke-width", 7.5)
			.selectAll("path")
			.data(linkData)
			.enter()
			.append("path")
			.attr("marker-end", "url(#arrow)");

		// Each link gets a label group (background rect + text) so text stays legible.
		const labelGroup = zoomGroup
			.append("g")
			.selectAll("g")
			.data(linkData)
			.enter()
			.append("g");

		labelGroup
			.append("rect")
			.attr("rx", 8)
			.attr("ry", 8)
			.attr("fill", "#f8fafc")
			.attr("stroke", "#cbd5e1")
			.attr("stroke-width", 1.2)
			.attr("opacity", 0.9);

		labelGroup
			.append("text")
			.attr("fill", "#0f172a")
			.attr("font-size", 11)
			.attr("font-weight", 700)
			.attr("text-anchor", "middle")
			.text((d) => d.label);

		// Nodes: draggable circles with bold labels.
		const node = zoomGroup
			.append("g")
			.selectAll("g")
			.data(nodeData)
			.enter()
			.append("g")
			.style("cursor", "grab")
			.call(
				d3
					.drag<SVGGElement, NodeDatum>()
					.on("start", (event, d) => {
						if (!event.active) sim.alphaTarget(0.35).restart();
						d.fx = d.x;
						d.fy = d.y;
					})
					.on("drag", (event, d) => {
						d.fx = event.x;
						d.fy = event.y;
					})
					.on("end", (event, d) => {
						if (!event.active) sim.alphaTarget(0);
						d.fx = null;
						d.fy = null;
					}),
			);

		node
			.append("circle")
			.attr("r", 46)
			.attr("fill", (d) => `url(#node-grad-${d.id})`)
			.attr("stroke", (d) => d.palette.stroke)
			.attr("stroke-width", 2.2)
			.attr("filter", "url(#node-shadow)");

		node
			.append("text")
			.attr("fill", (d) => d.palette.text)
			.attr("font-weight", 700)
			.attr("text-anchor", "middle")
			.attr("dy", 0)
			.selectAll("tspan")
			.data((d) => wrapLabel(d.id, 12))
			.enter()
			.append("tspan")
			.attr("x", 0)
			.attr("dy", (_, i) => (i === 0 ? "-0.4em" : "1.1em"))
			.text((d) => d);

		// Fit graph into viewport (used on load and zoom button).
		const fitToView = () => {
			const padding = 120;
			const xs = nodeData.map((n: D3NodeDatum) => n.x || 0);
			const ys = nodeData.map((n: D3NodeDatum) => n.y || 0);
			const minX = Math.min(...xs) - padding;
			const maxX = Math.max(...xs) + padding;
			const minY = Math.min(...ys) - padding;
			const maxY = Math.max(...ys) + padding;
			const dx = maxX - minX || 1;
			const dy = maxY - minY || 1;
			const scale = Math.min(width / dx, height / dy, 2.4);
			const tx = width / 2 - (minX + dx / 2) * scale;
			const ty = height / 2 - (minY + dy / 2) * scale;
			svg
				.transition()
				.duration(600)
				.call(
					zoomBehavior.transform,
					d3.zoomIdentity.translate(tx, ty).scale(scale),
				);
		};

		const zoomIn = () => {
			svg.transition().duration(220).call(zoomBehavior.scaleBy, 1.2);
		};
		const zoomOut = () => {
			svg.transition().duration(220).call(zoomBehavior.scaleBy, 0.83);
		};
		const reset = () => {
			svg
				.transition()
				.duration(280)
				.call(zoomBehavior.transform, d3.zoomIdentity);
		};

		controlsRef.current = { zoomIn, zoomOut, reset, fit: fitToView };

		// Anneal: start energetic, cool over ~5s, auto-fit along the way.
		sim.alpha(1.25).alphaTarget(0.45).restart();
		setTimeout(() => {
			sim.alphaTarget(0.28);
			fitToView();
		}, 1200);
		setTimeout(() => {
			sim.alphaTarget(0.16);
			fitToView();
		}, 2600);
		setTimeout(() => {
			sim.alphaTarget(0.08);
			fitToView();
		}, 4200);
		setTimeout(() => {
			sim.alphaTarget(0);
			fitToView();
		}, 5600);

		sim.on("tick", () => {
			const nodeRadius = 46;

			// Trim link so it stops short of node edge, leaving room for arrowhead + gap.
			const shrinkToCircle = (
				sx: number,
				sy: number,
				tx: number,
				ty: number,
			) => {
				const dx = tx - sx;
				const dy = ty - sy;
				const len = Math.sqrt(dx * dx + dy * dy) || 1;
				// Leave a visible gap between arrow tip and node body
				const pad = nodeRadius + 14;
				return {
					sx: sx + (dx / len) * pad,
					sy: sy + (dy / len) * pad,
					tx: tx - (dx / len) * pad,
					ty: ty - (dy / len) * pad,
					len,
					dx,
					dy,
				};
			};

			// Build quadratic curves (or self-loop cubic) on each tick.
			link.attr("d", (d: D3LinkDatum) => {
				const rawSx = d.source.x;
				const rawSy = d.source.y;
				const rawTx = d.target.x;
				const rawTy = d.target.y;
				const isSelf = d.source === d.target;

				if (isSelf) {
					const r = nodeRadius + 34;
					const start = { x: rawSx, y: rawSy - nodeRadius };
					const end = { x: rawSx + 4, y: rawSy - nodeRadius - 4 };
					const cx1 = start.x - r;
					const cy1 = start.y - r;
					const cx2 = start.x + r;
					const cy2 = start.y - r;
					return `M${start.x},${start.y} C${cx1},${cy1} ${cx2},${cy2} ${end.x},${end.y}`;
				}

				const { sx, sy, tx, ty, len, dx, dy } = shrinkToCircle(
					rawSx,
					rawSy,
					rawTx,
					rawTy,
				);
				const mx = (sx + tx) / 2;
				const my = (sy + ty) / 2;
				const sign = d.source.id < d.target.id ? 1 : -1;
				const nx = (-dy / len) * (d.offset || 0) * sign;
				const ny = (dx / len) * (d.offset || 0) * sign;
				const cx = mx + nx;
				const cy = my + ny;
				return `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`;
			});

			// Position label groups along the curve’s midpoint, offset to match curve bow.
			labelGroup.each(function (d: D3LinkDatum) {
				const rawSx = d.source.x;
				const rawSy = d.source.y;
				const rawTx = d.target.x;
				const rawTy = d.target.y;
				const isSelf = d.source === d.target;
				let x = rawSx;
				let y = rawSy - 70;

				if (!isSelf) {
					const { sx, sy, tx, ty, len, dx, dy } = shrinkToCircle(
						rawSx,
						rawSy,
						rawTx,
						rawTy,
					);
					const mx = (sx + tx) / 2;
					const my = (sy + ty) / 2;
					const sign = d.source.id < d.target.id ? 1 : -1;
					const nx = (-dy / len) * ((d.offset || 0) * 0.65) * sign;
					const ny = (dx / len) * ((d.offset || 0) * 0.65) * sign;
					x = mx + nx;
					y = my + ny - 6;
				}

				const text = d3.select(this).select("text");
				const rect = d3.select(this).select("rect");
				const approxWidth = Math.max(40, d.label.length * 6.2 + 16);
				const height = 20;
				rect
					.attr("width", approxWidth)
					.attr("height", height)
					.attr("x", -approxWidth / 2)
					.attr("y", -height / 2);
				text.attr("x", 0).attr("y", 4);
				d3.select(this).attr("transform", `translate(${x},${y})`);
			});

			node.attr("transform", (d: D3NodeDatum) => `translate(${d.x},${d.y})`);
		});

		return () => {
			sim.stop();
		};
	}, []);

	useEffect(() => {
		const zoomBehavior = zoomBehaviorRef.current;
		const svg = svgSelectionRef.current;
		if (!zoomBehavior || !svg) return;
		zoomBehavior.filter((event) => {
			if (!isFullscreen && event.type === "wheel") return false;
			return !event.ctrlKey && !event.button;
		});
		svg.call(zoomBehavior);
	}, [isFullscreen]);

	useEffect(() => {
		if (isFullscreen) {
			bodyOverflowRef.current = document.body.style.overflow;
			document.body.style.overflow = "hidden";
			return () => {
				document.body.style.overflow = bodyOverflowRef.current;
			};
		}
		document.body.style.overflow = bodyOverflowRef.current;
	}, [isFullscreen]);

	const shellStyle: CSSProperties = isFullscreen
		? {
				position: "fixed",
				inset: "0",
				zIndex: 1600,
				background: "#0b1220",
				padding: "0",
				boxSizing: "border-box",
				display: "flex",
				flexDirection: "column",
			}
		: { position: "relative" };

	const frameStyle: CSSProperties = isFullscreen
		? {
				position: "relative",
				width: "100vw",
				height: "100vh",
				overflow: "hidden",
				paddingTop: "64px",
			}
		: {
				position: "relative",
				minHeight: "520px",
				flex: 1,
				borderRadius: "12px",
				overflow: "hidden",
				boxShadow: "0 24px 68px rgba(0, 0, 0, 0.35)",
			};

	const svgStyle: CSSProperties = isFullscreen
		? {
				width: "100%",
				height: "100%",
				minHeight: "100vh",
			}
		: {
				width: "100%",
				minHeight: "520px",
			};

	const controlsTop = isFullscreen ? "82px" : "14px";

	return (
		<Layout>
			<Header
				title="Workflow Graph"
				subtitle="States and transitions of the worker token"
				showAuthControls={false}
			/>
			<nav
				style={{
					display: "flex",
					gap: "12px",
					marginBottom: "12px",
					alignItems: "center",
				}}
			>
				<Link to="/overview" style={{ color: "#334155", textDecoration: "none" }}>
					← Back to overview
				</Link>
			</nav>
			<SectionCard
				title="Coloured Petri Token Flow"
				countLabel="D3 visualization"
			>
				<div style={shellStyle}>
					{isFullscreen && (
						<div
							style={{
								position: "fixed",
								top: "16px",
								left: "16px",
								right: "16px",
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								color: "#e2e8f0",
								gap: "12px",
								zIndex: 1700,
							}}
						>
							<div style={{ fontWeight: 700, letterSpacing: "0.4px" }}>
								Full-screen workflow graph
							</div>
							<button
								type="button"
								onClick={() => setIsFullscreen(false)}
								style={{
									background: "#111827",
									color: "#e2e8f0",
									border: "1px solid #1f2937",
									borderRadius: "10px",
									padding: "8px 12px",
									cursor: "pointer",
									fontWeight: 700,
								}}
							>
								Exit full-screen
							</button>
						</div>
					)}
					<div style={frameStyle}>
						<svg ref={svgRef} style={svgStyle} />
						<div
							style={{
								position: "absolute",
								right: "14px",
								top: controlsTop,
								display: "flex",
								gap: "8px",
								background: "rgba(255,255,255,0.92)",
								border: "1px solid #e2e8f0",
								borderRadius: "10px",
								padding: "6px 8px",
								boxShadow: "0 10px 24px rgba(15, 23, 42, 0.12)",
							}}
						>
							<button
								type="button"
								onClick={() => controlsRef.current.zoomIn?.()}
								style={zoomBtnStyle}
								aria-label="Zoom in"
							>
								+
							</button>
							<button
								type="button"
								onClick={() => controlsRef.current.zoomOut?.()}
								style={zoomBtnStyle}
								aria-label="Zoom out"
							>
								–
							</button>
							<button
								type="button"
								onClick={() => controlsRef.current.fit?.()}
								style={zoomBtnStyle}
								aria-label="Fit graph"
							>
								⤢
							</button>
							<button
								type="button"
								onClick={() => controlsRef.current.reset?.()}
								style={zoomBtnStyle}
								aria-label="Reset view"
							>
								⟲
							</button>
							<button
								type="button"
								onClick={() => setIsFullscreen((prev) => !prev)}
								style={zoomBtnStyle}
								aria-label={
									isFullscreen ? "Exit full screen" : "Enter full screen"
								}
							>
								{isFullscreen ? "🗕" : "🗖"}
							</button>
						</div>
					</div>
				</div>
			</SectionCard>
		</Layout>
	);
}

const zoomBtnStyle: CSSProperties = {
	background: "#0f172a",
	color: "#fff",
	border: "none",
	width: 32,
	height: 32,
	borderRadius: 8,
	fontWeight: 800,
	cursor: "pointer",
	display: "grid",
	placeItems: "center",
	boxShadow: "0 6px 14px rgba(15, 23, 42, 0.16)",
};

function wrapLabel(id: string, max = 12): string[] {
	const raw = id.replace(/-/g, " ");
	const words = raw.split(" ");
	const lines: string[] = [];
	let line = "";
	for (const w of words) {
		if (`${line} ${w}`.trim().length > max && line.length > 0) {
			lines.push(line.trim());
			line = w;
		} else {
			line += ` ${w}`;
		}
	}
	if (line.trim()) lines.push(line.trim());
	return lines;
}
