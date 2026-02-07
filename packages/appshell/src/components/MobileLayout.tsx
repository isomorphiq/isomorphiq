import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { authAtom } from "../authAtoms.ts";
import { useOfflineSync } from "../hooks/useOfflineSync.ts";

type MobileLayoutProps = {
	children: React.ReactNode;
	showNav?: boolean;
	showFooter?: boolean;
};

export function MobileLayout({ children, showNav = true, showFooter = true }: MobileLayoutProps) {
	const auth = useAtomValue(authAtom);
	const location = useLocation();
	const [_showMobileMenu, setShowMobileMenu] = useState(false);
	const [_showUserMenu, _setShowUserMenu] = useState(false);
	const { isOnline, syncInProgress, getSyncQueueSize } = useOfflineSync();
	const [_syncQueueSize, setSyncQueueSize] = useState(0);
	const getIsMobile = () => (typeof window !== "undefined" ? window.innerWidth <= 768 : false);
	const [isMobile, setIsMobile] = useState(getIsMobile());

	useEffect(() => {
		const updateSyncQueueSize = async () => {
			const size = await getSyncQueueSize();
			setSyncQueueSize(size);
		};
		updateSyncQueueSize();
		const interval = setInterval(updateSyncQueueSize, 5000);
		return () => clearInterval(interval);
	}, [getSyncQueueSize]);

	useEffect(() => {
		const handleResize = () => setIsMobile(getIsMobile());
		if (typeof window !== "undefined") {
			window.addEventListener("resize", handleResize);
			return () => window.removeEventListener("resize", handleResize);
		}
		return () => {};
	}, []);

	const navItems = [
		{ to: "/", label: "Dashboard", icon: "📊" },
		{ to: "/analytics", label: "Analytics", icon: "📈" },
		{ to: "/activity", label: "Activity", icon: "🔔" },
		{ to: "/portfolio", label: "Portfolio", icon: "🗂️", requireAuth: true },
		{ to: "/profiles", label: "Profiles", icon: "👥" },
		{ to: "/workflow", label: "Workflow", icon: "🕸️" },
		{ to: "/dependencies", label: "Dependencies", icon: "🔗" },
		{ to: "/users/me", label: "Profile", icon: "👤", requireAuth: true },
	];

	return (
		<div
			style={{
				minHeight: "100vh",
				fontFamily: "Inter, system-ui, sans-serif",
				background: "#0f172a",
				color: "#e2e8f0",
				display: "flex",
				flexDirection: "column",
			}}
		>
			{/* Header */}
			<header
				style={{
					padding: isMobile ? "12px 16px" : "16px 24px",
					borderBottom: "1px solid #1f2937",
					background: "#0b1220",
					position: "sticky",
					top: 0,
					zIndex: 100,
				}}
			>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
						{isMobile && (
							<button
								type="button"
								onClick={() => setShowMobileMenu(true)}
								style={{
									background: "none",
									border: "none",
									color: "#e2e8f0",
									fontSize: "20px",
									cursor: "pointer",
								}}
							>
								☰
							</button>
						)}
						<h1 style={{ margin: 0, fontSize: "18px", fontWeight: "600" }}>Opencode</h1>
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
						{auth && (
							<span style={{ fontSize: "12px", color: "#94a3b8" }}>{auth.user.username}</span>
						)}
					</div>
				</div>
			</header>

			{/* Mobile Menu Overlay */}
			{_showMobileMenu && (
				<div
					role="dialog"
					aria-modal="true"
					aria-labelledby="mobile-menu-title"
					style={{
						position: "fixed",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						background: "rgba(0, 0, 0, 0.5)",
						zIndex: 200,
						display: "flex",
						flexDirection: "column",
					}}
					onClick={() => setShowMobileMenu(false)}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							setShowMobileMenu(false);
						}
					}}
				>
					<div
						role="dialog"
						aria-modal="true"
						style={{
							background: "#0b1220",
							padding: "20px",
							maxWidth: "300px",
							width: "100%",
							height: "100%",
							overflowY: "auto",
						}}
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								marginBottom: "20px",
							}}
						>
							<h2 id="mobile-menu-title" style={{ margin: 0, color: "#e2e8f0" }}>
								Menu
							</h2>
							<button
								type="button"
								onClick={() => setShowMobileMenu(false)}
								style={{
									background: "none",
									border: "none",
									color: "#e2e8f0",
									fontSize: "24px",
									cursor: "pointer",
								}}
							>
								✕
							</button>
						</div>
						<nav
							style={{
								display: "flex",
								flexDirection: "column",
								gap: "8px",
							}}
						>
							{navItems.map((item) => {
								if (item.requireAuth && !auth) return null;
								const active = location.pathname === item.to;
								return (
									<Link
										key={item.to}
										to={item.to}
										onClick={() => setShowMobileMenu(false)}
										style={{
											padding: "12px 16px",
											borderRadius: "8px",
											textDecoration: "none",
											color: active ? "#0ea5e9" : "#e2e8f0",
											background: active ? "rgba(14, 165, 233, 0.1)" : "transparent",
											display: "flex",
											alignItems: "center",
											gap: "10px",
											border: active ? "1px solid #0ea5e9" : "1px solid transparent",
											fontSize: "16px",
										}}
									>
										<span style={{ fontSize: "18px" }}>{item.icon}</span>
										{item.label}
									</Link>
								);
							})}
						</nav>
					</div>
				</div>
			)}

			{/* Main Content */}
			<main
				style={{
					flex: 1,
					padding: isMobile ? "16px" : "24px",
					overflowY: "auto",
				}}
			>
				{children}
			</main>

			{/* Mobile Bottom Navigation */}
			{isMobile && showNav && (
				<div
					style={{
						position: "fixed",
						bottom: 0,
						left: 0,
						right: 0,
						background: "#0b1220",
						borderTop: "1px solid #1f2937",
						padding: "8px 0",
						zIndex: 90,
						display: "flex",
						justifyContent: "space-around",
						alignItems: "center",
					}}
				>
					{[
						{ to: "/", label: "Home", icon: "📊" },
						{ to: "/analytics", label: "Analytics", icon: "📈" },
						{ to: "/activity", label: "Activity", icon: "🔔" },
						{ to: "/profiles", label: "Profiles", icon: "👥" },
					].map((item) => {
						const active = location.pathname === item.to;
						return (
							<Link
								key={item.to}
								to={item.to}
								style={{
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									gap: "2px",
									textDecoration: "none",
									color: active ? "#0ea5e9" : "#94a3b8",
									fontSize: "10px",
								}}
							>
								<span style={{ fontSize: "16px" }}>{item.icon}</span>
								{item.label}
							</Link>
						);
					})}
				</div>
			)}

			{/* Footer */}
			{showFooter && !isMobile && (
				<footer
					style={{
						padding: "16px 24px",
						borderTop: "1px solid #1f2937",
						color: "#94a3b8",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						fontSize: "12px",
						background: "#0b1220",
					}}
				>
					<span>Isomorphiq Task Manager · v1.0.0</span>
					<span>
						Status:{" "}
						<span style={{ color: isOnline ? "#22c55e" : "#ef4444" }}>
							{isOnline ? "online" : "offline"}
						</span>
						{syncInProgress && " · syncing..."}
					</span>
				</footer>
			)}

			{/* Add padding for mobile bottom nav */}
			{isMobile && showNav && <div style={{ height: "60px" }} />}

			<style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `}</style>
		</div>
	);
}
