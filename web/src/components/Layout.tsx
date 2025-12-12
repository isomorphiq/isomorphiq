import { useAtomValue } from "jotai";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { authAtom } from "../authAtoms.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

type LayoutProps = {
	children: ReactNode;
	showNav?: boolean;
	showFooter?: boolean;
};

export function Layout({ children, showNav = true, showFooter = true }: LayoutProps) {
	const auth = useAtomValue(authAtom);
	const location = useLocation();
	const [showUserMenu, setShowUserMenu] = useState(false);
	// Registration always open for now; adjust when status endpoint is wired
	const registrationDisabled = false;

	const navItems = [
		{ to: "/", label: "Dashboard", icon: "📊" },
		{ to: "/analytics", label: "Analytics", icon: "📈" },
		{ to: "/activity", label: "Activity", icon: "🔔" },
		{ to: "/profiles", label: "Profiles", icon: "👥" },
		{ to: "/workflow", label: "Workflow", icon: "🕸️" },
		{ to: "/dependencies", label: "Dependencies", icon: "🔗" },
		{ to: "/users/me", label: "My Profile", icon: "👤", requireAuth: true },
	];

	return (
		<div
			style={{
				padding: "24px",
				fontFamily: "Inter, system-ui, sans-serif",
				background: "var(--color-bg-primary)",
				minHeight: "100vh",
				color: "var(--color-text-primary)",
			}}
		>
			<header style={headerShell}>
				<div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
					<Link
						to="/"
						style={{
							color: "var(--color-text-primary)",
							fontWeight: 800,
							textDecoration: "none",
							fontFamily: "Bruno Ace, Inter, system-ui",
							textTransform: "lowercase",
							fontSize: "22px",
						}}
					>
						isomorphiq
					</Link>
					{showNav && (
						<nav style={navShell}>
							{navItems
								.filter((item) => !item.requireAuth || auth.isAuthenticated)
								.map((item) => {
									const active = location.pathname === item.to;
									return (
										<Link
											key={item.to}
											to={item.to}
											style={{
												textDecoration: "none",
												color: active ? "var(--color-bg-primary)" : "var(--color-text-primary)",
												background: active ? "var(--color-accent-primary)" : "transparent",
												padding: "8px 12px",
												borderRadius: "8px",
												fontWeight: 700,
												display: "flex",
												alignItems: "center",
												gap: "6px",
												border: active ? "1px solid var(--color-accent-primary)" : "1px solid transparent",
												transition: "all 0.2s ease",
											}}
										>
											<span>{item.icon}</span>
											{item.label}
										</Link>
									);
								})}
						</nav>
					)}
				</div>

				<div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
					<ThemeToggle size="small" />
					{auth.isAuthenticated && auth.user ? (
					<div style={{ position: "relative" }}>
						<button type="button" onClick={() => setShowUserMenu((s) => !s)} style={userButton}>
							<span>{auth.user.username || auth.user.email}</span>
							<span style={{ fontSize: "12px" }}>▼</span>
						</button>
						{showUserMenu && (
							<div style={menuPanel}>
								<div
									style={{ padding: "10px", borderBottom: "1px solid var(--color-border-primary)", color: "var(--color-text-secondary)" }}
								>
									<div style={{ fontWeight: 700 }}>{auth.user.username}</div>
									<div style={{ fontSize: "12px" }}>{auth.user.email}</div>
								</div>
								<Link to="/users/me" onClick={() => setShowUserMenu(false)} style={menuLinkStyle}>
									⚙️ Profile
								</Link>
								<Link to="/security" onClick={() => setShowUserMenu(false)} style={menuLinkStyle}>
									🔒 Security
								</Link>
								<button
									type="button"
									onClick={() => {
										localStorage.removeItem("authToken");
										localStorage.removeItem("user");
										window.location.href = "/login";
									}}
									style={{
										...menuLinkStyle,
										width: "100%",
										textAlign: "left",
										border: "none",
										background: "transparent",
										color: "var(--color-accent-error)",
									}}
								>
									🚪 Logout
								</button>
							</div>
						)}
					</div>
				) : (
					<div style={{ display: "flex", gap: "8px" }}>
						<Link to="/login" style={loginBtn}>
							Login
						</Link>
						<Link to="/register" style={registerBtn}>
							Register
						</Link>
					</div>
				)}
				</div>
			</header>

			{children}
			{showFooter && (
				<footer
					style={{
						marginTop: "32px",
						paddingTop: "12px",
						borderTop: "1px solid var(--color-border-primary)",
						color: "var(--color-text-muted)",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						fontSize: "12px",
					}}
				>
					<span>Opencode Task Manager · v1.0.0</span>
					<span>
						Status: <span style={{ color: "var(--color-accent-success)" }}>online</span>
					</span>
				</footer>
			)}
		</div>
	);
}

const headerShell: CSSProperties = {
	marginBottom: "18px",
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	flexWrap: "wrap",
	gap: "12px",
	fontFamily: "Space Grotesk, Inter, system-ui, sans-serif",
};

const navShell: CSSProperties = {
	display: "flex",
	gap: "10px",
	alignItems: "center",
	background: "var(--color-surface-secondary)",
	border: "1px solid var(--color-border-primary)",
	borderRadius: "12px",
	padding: "10px 12px",
	boxShadow: "0 10px 24px var(--color-shadow-lg)",
};

const userButton: CSSProperties = {
	padding: "8px 12px",
	background: "var(--color-surface-primary)",
	border: "1px solid var(--color-border-primary)",
	borderRadius: "8px",
	color: "var(--color-text-primary)",
	fontSize: "14px",
	cursor: "pointer",
	display: "flex",
	alignItems: "center",
	gap: "8px",
};

const menuPanel: CSSProperties = {
	position: "absolute",
	top: "calc(100% + 6px)",
	right: 0,
	background: "var(--color-surface-secondary)",
	border: "1px solid var(--color-border-primary)",
	borderRadius: "10px",
	boxShadow: "0 10px 20px var(--color-shadow-xl)",
	minWidth: "200px",
	zIndex: 20,
};

const menuLinkStyle: CSSProperties = {
	display: "block",
	padding: "10px 12px",
	color: "var(--color-text-primary)",
	textDecoration: "none",
	fontWeight: 600,
	borderBottom: "1px solid var(--color-border-primary)",
};

const loginBtn: CSSProperties = {
	background: "var(--color-accent-primary)",
	color: "white",
	padding: "8px 14px",
	borderRadius: "8px",
	textDecoration: "none",
	fontWeight: 700,
	boxShadow: "0 6px 16px var(--color-shadow-md)",
};

const registerBtn: CSSProperties = {
	background: "transparent",
	color: "var(--color-text-primary)",
	padding: "8px 14px",
	borderRadius: "8px",
	textDecoration: "none",
	fontWeight: 700,
	border: "1px solid var(--color-border-primary)",
};

export function Header({
	title,
	subtitle,
	showAuthControls = true,
	user,
	onLogout,
}: {
	title: string;
	subtitle?: string;
	user?: { username?: string; email?: string };
	onLogout?: () => void;
	showAuthControls?: boolean;
}) {
	const [showUserMenu, setShowUserMenu] = useState(false);
	// Registration always open for now; adjust when status endpoint is wired
	const registrationDisabled = false;

	return (
		<header
			style={{
				marginBottom: "24px",
				display: "flex",
				justifyContent: "space-between",
				alignItems: "flex-start",
			}}
		>
			<div>
				<h1 style={{ margin: 0, fontSize: "28px", letterSpacing: "-0.5px" }}>{title}</h1>
				{subtitle && <p style={{ margin: "6px 0 0", color: "var(--color-text-muted)" }}>{subtitle}</p>}
			</div>

			{showAuthControls && user && onLogout ? (
				<div style={{ position: "relative" }}>
					<button
						type="button"
						onClick={() => setShowUserMenu(!showUserMenu)}
						style={{
							padding: "8px 12px",
							background: "var(--color-surface-primary)",
							border: "1px solid var(--color-border-primary)",
							borderRadius: "6px",
							color: "var(--color-text-primary)",
							fontSize: "14px",
							cursor: "pointer",
							display: "flex",
							alignItems: "center",
							gap: "8px",
						}}
					>
						<span>{user.username || user.email}</span>
						<span style={{ fontSize: "12px" }}>▼</span>
					</button>

					{showUserMenu && (
						<div
							style={{
								position: "absolute",
								top: "100%",
								right: 0,
								marginTop: "4px",
								background: "var(--color-surface-primary)",
								border: "1px solid var(--color-border-primary)",
								borderRadius: "6px",
								boxShadow: "0 4px 12px var(--color-shadow-lg)",
								zIndex: 1000,
								minWidth: "160px",
							}}
						>
							<div style={{ padding: "4px 0" }}>
								<div
									style={{
										padding: "8px 12px",
										fontSize: "12px",
										color: "var(--color-text-muted)",
										borderBottom: "1px solid var(--color-border-primary)",
										marginBottom: "4px",
									}}
								>
									{user.email}
								</div>
								<Link
									to="/profile"
									style={{
										display: "block",
										padding: "8px 12px",
										color: "var(--color-text-primary)",
										textDecoration: "none",
										fontSize: "14px",
									}}
									onClick={() => setShowUserMenu(false)}
									onMouseEnter={(e) => {
										e.currentTarget.style.background = "var(--color-state-hover-bg)";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = "transparent";
									}}
								>
									⚙️ Profile Settings
								</Link>
								<Link
									to="/security"
									style={{
										display: "block",
										padding: "8px 12px",
										color: "var(--color-text-primary)",
										textDecoration: "none",
										fontSize: "14px",
									}}
									onClick={() => setShowUserMenu(false)}
									onMouseEnter={(e) => {
										e.currentTarget.style.background = "var(--color-state-hover-bg)";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = "transparent";
									}}
								>
									🔒 Security
								</Link>
								<button
									type="button"
									onClick={() => {
										onLogout();
										setShowUserMenu(false);
									}}
									style={{
										width: "100%",
										padding: "8px 12px",
										background: "transparent",
										border: "none",
										color: "var(--color-accent-error)",
										textAlign: "left",
										fontSize: "14px",
										cursor: "pointer",
									}}
								>
									🚪 Logout
								</button>
							</div>
						</div>
					)}
				</div>
			) : showAuthControls ? (
				<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
					<Link
						to="/login"
						style={{
							background: "var(--color-accent-primary)",
							color: "white",
							padding: "8px 14px",
							borderRadius: "8px",
							textDecoration: "none",
							fontWeight: 600,
							boxShadow: "0 6px 16px var(--color-shadow-md)",
						}}
					>
						Login
					</Link>
					{!registrationDisabled ? (
						<Link
							to="/register"
							style={{
								background: "transparent",
								color: "var(--color-text-primary)",
								padding: "8px 14px",
								borderRadius: "8px",
								textDecoration: "none",
								fontWeight: 600,
								border: "1px solid var(--color-border-primary)",
							}}
						>
							Register
						</Link>
					) : (
						<span
							style={{
								color: "var(--color-text-muted)",
								fontSize: "13px",
								padding: "6px 10px",
								borderRadius: "8px",
								border: "1px dashed var(--color-border-primary)",
								background: "var(--color-surface-tertiary)",
							}}
						>
							Signups closed
						</span>
					)}
				</div>
			) : null}
		</header>
	);
}
