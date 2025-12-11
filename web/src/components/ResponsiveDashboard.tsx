import { useEffect, useState } from "react";

interface ResponsiveDashboardProps {
	totalTasks: number;
	todoCount: number;
	inProgressCount: number;
	doneCount: number;
	nextUp?: { title?: string } | null;
	isOnline: boolean;
	syncInProgress: boolean;
}

export function ResponsiveDashboard({
	totalTasks,
	todoCount,
	inProgressCount,
	doneCount,
	nextUp,
	isOnline,
	syncInProgress,
}: ResponsiveDashboardProps) {
	const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
	const [showQuickActions, setShowQuickActions] = useState(false);

	useEffect(() => {
		const handleResize = () => {
			setIsMobile(window.innerWidth <= 768);
		};
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	const summaryCards = [
		{ label: "Next Up", value: nextUp ? nextUp.title : "—", accent: "#38bdf8", icon: "🎯" },
		{ label: "In Progress", value: inProgressCount, accent: "#f59e0b", icon: "⚡" },
		{ label: "Todo", value: todoCount, accent: "#3b82f6", icon: "📋" },
		{ label: "Done", value: doneCount, accent: "#22c55e", icon: "✅" },
		{ label: "Total", value: totalTasks, accent: "#c084fc", icon: "📊" },
	];

	if (isMobile) {
		return (
			<div style={{ marginBottom: "16px" }}>
				{/* Mobile Status Bar */}
				<div
					style={{
						background: "#0b1220",
						border: "1px solid #1f2937",
						borderRadius: "12px",
						padding: "12px",
						marginBottom: "16px",
						boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
					}}
				>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: "8px",
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
							<div
								style={{
									width: "12px",
									height: "12px",
									borderRadius: "50%",
									background: isOnline ? "#22c55e" : "#ef4444",
									animation: isOnline ? "pulse 2s infinite" : "none",
								}}
							/>
							<span
								style={{
									fontSize: "14px",
									fontWeight: 600,
									color: isOnline ? "#22c55e" : "#ef4444",
								}}
							>
								{isOnline ? "Online" : "Offline"}
							</span>
							{syncInProgress && (
								<span
									style={{
										fontSize: "12px",
										color: "#f59e0b",
										fontWeight: 600,
									}}
								>
									syncing...
								</span>
							)}
						</div>
						<button
							type="button"
							onClick={() => setShowQuickActions(!showQuickActions)}
							style={{
								background: "none",
								border: "none",
								color: "#e2e8f0",
								fontSize: "20px",
								cursor: "pointer",
								padding: "4px",
								borderRadius: "6px",
							}}
						>
							{showQuickActions ? "✕" : "⚡"}
						</button>
					</div>

					{/* Quick Actions */}
					{showQuickActions && (
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "1fr 1fr",
								gap: "8px",
								marginTop: "12px",
							}}
						>
							<button
								type="button"
								style={{
									padding: "8px 12px",
									borderRadius: "8px",
									border: "1px solid #374151",
									background: "#1f2937",
									color: "#e2e8f0",
									fontSize: "12px",
									fontWeight: 600,
									cursor: "pointer",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									gap: "6px",
								}}
							>
								📝 New Task
							</button>
							<button
								type="button"
								style={{
									padding: "8px 12px",
									borderRadius: "8px",
									border: "1px solid #374151",
									background: "#1f2937",
									color: "#e2e8f0",
									fontSize: "12px",
									fontWeight: 600,
									cursor: "pointer",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									gap: "6px",
								}}
							>
								🔄 Refresh
							</button>
							<button
								type="button"
								style={{
									padding: "8px 12px",
									borderRadius: "8px",
									border: "1px solid #374151",
									background: "#1f2937",
									color: "#e2e8f0",
									fontSize: "12px",
									fontWeight: 600,
									cursor: "pointer",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									gap: "6px",
								}}
							>
								🔍 Search
							</button>
							<button
								type="button"
								style={{
									padding: "8px 12px",
									borderRadius: "8px",
									border: "1px solid #374151",
									background: "#1f2937",
									color: "#e2e8f0",
									fontSize: "12px",
									fontWeight: 600,
									cursor: "pointer",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									gap: "6px",
								}}
							>
								📈 Analytics
							</button>
						</div>
					)}
				</div>

				{/* Mobile Summary Cards */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(2, 1fr)",
						gap: "8px",
					}}
				>
					{summaryCards.map((card, _index) => (
						<div
							key={card.label}
							style={{
								padding: "12px",
								borderRadius: "10px",
								border: "1px solid #1f2937",
								background: "#0b1220",
								boxShadow: "0 6px 12px rgba(0,0,0,0.25)",
								minHeight: "60px",
								display: "flex",
								flexDirection: "column",
								justifyContent: "center",
							}}
						>
							<div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: "4px" }}>
								{card.icon} {card.label}
							</div>
							<div
								style={{
									fontWeight: 800,
									fontSize: "16px",
									color: card.accent,
									lineHeight: 1.2,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{typeof card.value === "string" ? card.value : card.value}
							</div>
						</div>
					))}
				</div>
			</div>
		);
	}

	// Desktop version
	return (
		<div style={{ marginBottom: "16px" }}>
			{/* Desktop Summary Strip */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
					gap: "10px",
				}}
			>
				{summaryCards.map((card) => (
					<div
						key={card.label}
						style={{
							padding: "12px",
							borderRadius: "12px",
							border: "1px solid #1f2937",
							background: "#0b1220",
							boxShadow: "0 10px 20px rgba(0,0,0,0.25)",
							minHeight: "72px",
						}}
					>
						<div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "6px" }}>
							{card.icon} {card.label}
						</div>
						<div
							style={{
								fontWeight: 800,
								fontSize: "18px",
								color: card.accent,
								lineHeight: 1.2,
							}}
						>
							{typeof card.value === "string" ? card.value : card.value}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
