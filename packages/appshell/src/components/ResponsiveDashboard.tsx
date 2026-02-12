// FILE_CONTEXT: "context-5fb2ac35-d086-4cc8-80d2-a680e6fa5d6c"

import { useEffect, useId, useRef, useState } from "react";
import * as addWidget from "../../supervisor/src/add_widget_to_dashboard.ts";
import * as dashboardLayout from "../../supervisor/src/dashboard-layout.ts";
import { ActionErrorBanner, useFeedbackToasts } from "./ActionFeedback.tsx";

const visuallyHiddenStyle = {
	position: "absolute",
	width: "1px",
	height: "1px",
	padding: 0,
	margin: "-1px",
	overflow: "hidden",
	clip: "rect(0 0 0 0)",
	whiteSpace: "nowrap",
	border: 0,
};

type ResponsiveDashboardProps = {
	totalTasks: number;
	todoCount: number;
	inProgressCount: number;
	doneCount: number;
	nextUp?: { title?: string } | null;
	isOnline: boolean;
	syncInProgress: boolean;
	isLoading: boolean;
	onQuickNewTask?: () => Promise<void> | void;
	onQuickRefresh?: () => Promise<void> | void;
	onQuickSearch?: () => Promise<void> | void;
	onQuickAnalytics?: () => Promise<void> | void;
};

type QuickActionKey = "new-task" | "refresh" | "search" | "analytics";

type QuickAction = {
	key: QuickActionKey;
	label: string;
	icon: string;
	onTrigger?: () => Promise<void> | void;
	successMessage: string;
	tone?: "success" | "info";
	shortcut?: string;
};

type ActionError = {
	message: string;
	actionLabel?: string;
	onAction?: () => void;
};

export function ResponsiveDashboard({
	totalTasks,
	todoCount,
	inProgressCount,
	doneCount,
	nextUp,
	isOnline,
	syncInProgress,
	isLoading,
	onQuickNewTask,
	onQuickRefresh,
	onQuickSearch,
	onQuickAnalytics,
}: ResponsiveDashboardProps) {
	const [showQuickActions, setShowQuickActions] = useState(false);
	const [isUpdating, setIsUpdating] = useState(false);
	const [pendingAction, setPendingAction] = useState<QuickActionKey | null>(null);
	const [quickActionError, setQuickActionError] = useState<ActionError | null>(null);
	const [metricsAnnouncement, setMetricsAnnouncement] = useState("");
	const [statusAnnouncement, setStatusAnnouncement] = useState("");
	const hasMountedMetricsRef = useRef(false);
	const hasMountedStatusRef = useRef(false);
	const lastMetricsRef = useRef("");
	const lastStatusRef = useRef("");
	const quickActionsId = useId();
	const summaryHeadingId = useId();
	const { pushToast } = useFeedbackToasts();

	const updateSignature = [
		totalTasks,
		todoCount,
		inProgressCount,
		doneCount,
		nextUp?.title ?? "",
	].join("|");

	useEffect(() => {
		if (isLoading) {
			setIsUpdating(false);
			return;
		}
		setIsUpdating(true);
		const timeout = setTimeout(() => setIsUpdating(false), 220);
		return () => clearTimeout(timeout);
	}, [isLoading, updateSignature]);

	useEffect(() => {
		if (isLoading) {
			setMetricsAnnouncement("");
			return;
		}
		if (!hasMountedMetricsRef.current) {
			hasMountedMetricsRef.current = true;
			return;
		}
		const nextMessage = [
			"Dashboard metrics updated.",
			`Total ${totalTasks}.`,
			`Todo ${todoCount}.`,
			`In Progress ${inProgressCount}.`,
			`Done ${doneCount}.`,
			nextUp?.title ? `Next Up ${nextUp.title}.` : "",
		]
			.filter(Boolean)
			.join(" ");

		if (nextMessage === lastMetricsRef.current) {
			return;
		}

		const timeout = setTimeout(() => {
			lastMetricsRef.current = nextMessage;
			setMetricsAnnouncement(nextMessage);
		}, 240);

		return () => clearTimeout(timeout);
	}, [isLoading, totalTasks, todoCount, inProgressCount, doneCount, nextUp?.title]);

	useEffect(() => {
		if (!hasMountedStatusRef.current) {
			hasMountedStatusRef.current = true;
			return;
		}
		const nextMessage = `${isOnline ? "Online" : "Offline"}. ${
			syncInProgress ? "Sync in progress." : "Sync complete."
		}`;

		if (nextMessage === lastStatusRef.current) {
			return;
		}

		const timeout = setTimeout(() => {
			lastStatusRef.current = nextMessage;
			setStatusAnnouncement(nextMessage);
		}, 140);

		return () => clearTimeout(timeout);
	}, [isOnline, syncInProgress]);

	const summaryCards = [
		{
			label: "Next Up",
			value: isLoading ? "..." : nextUp ? nextUp.title : "—",
			accent: "var(--color-accent-secondary)",
			icon: "🎯",
		},
		{
			label: "In Progress",
			value: isLoading ? "..." : inProgressCount,
			accent: "var(--color-accent-warning)",
			icon: "⚡",
		},
		{
			label: "Todo",
			value: isLoading ? "..." : todoCount,
			accent: "var(--color-accent-primary)",
			icon: "📋",
		},
		{
			label: "Done",
			value: isLoading ? "..." : doneCount,
			accent: "var(--color-accent-success)",
			icon: "✅",
		},
		{
			label: "Total",
			value: isLoading ? "..." : totalTasks,
			accent: "var(--color-accent-primary-hover)",
			icon: "📊",
		},
	];

	const quickActions: QuickAction[] = [
		{
			key: "new-task",
			label: "New Task",
			icon: "📝",
			onTrigger: onQuickNewTask,
			successMessage: "Ready to create a new task.",
			tone: "success",
			shortcut: "N",
		},
		{
			key: "refresh",
			label: "Refresh",
			icon: "🔄",
			onTrigger: onQuickRefresh,
			successMessage: "Refreshing tasks.",
			tone: "success",
		},
		{
			key: "search",
			label: "Search",
			icon: "🔍",
			onTrigger: onQuickSearch,
			successMessage: "Search ready.",
			tone: "info",
		},
		{
			key: "analytics",
			label: "Analytics",
			icon: "📈",
			onTrigger: onQuickAnalytics,
			successMessage: "Opening analytics.",
			tone: "info",
		},
	];

	const handleQuickAction = async (action: QuickAction) => {
		if (pendingAction) {
			return;
		}
		setPendingAction(action.key);
		setQuickActionError(null);

		try {
			if (!action.onTrigger) {
				throw new Error("This action is unavailable right now.");
			}
			await action.onTrigger();
			pushToast({ message: action.successMessage, tone: action.tone ?? "success" });
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: "Something went wrong. Please try again.";
			setQuickActionError({
				message,
				actionLabel: "Retry",
				onAction: () => void handleQuickAction(action),
			});
			setShowQuickActions(true);
		} finally {
			setPendingAction(null);
		}
	};

	return (
		<div style={{ marginBottom: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
			<div aria-live="polite" aria-atomic="true" style={visuallyHiddenStyle}>
				{metricsAnnouncement}
			</div>
			<div role="status" aria-live="polite" aria-atomic="true" style={visuallyHiddenStyle}>
				{statusAnnouncement}
			</div>
			<div
				role="group"
				aria-label="Connection status"
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: "12px",
					alignItems: "center",
					justifyContent: "space-between",
					background: "var(--color-surface-secondary)",
					border: "1px solid var(--color-border-secondary)",
					borderRadius: "12px",
					padding: "12px",
					boxShadow: "0 10px 20px var(--color-shadow-lg)",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
					<div
						aria-hidden="true"
						style={{
							width: "12px",
							height: "12px",
							borderRadius: "50%",
							background: isOnline ? "var(--color-accent-success)" : "var(--color-accent-error)",
							animation: isOnline ? "pulse 2s infinite" : "none",
						}}
					/>
					<span
						style={{
							fontSize: "14px",
							fontWeight: 700,
							color: isOnline ? "var(--color-accent-success)" : "var(--color-accent-error)",
						}}
					>
						{isOnline ? "Online" : "Offline"}
					</span>
					{syncInProgress && (
						<span
							style={{ fontSize: "12px", color: "var(--color-accent-warning)", fontWeight: 700 }}
						>
							syncing...
						</span>
					)}
					{!isLoading && nextUp?.title && (
						<span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
							Next: {nextUp.title}
						</span>
					)}
				</div>
				<button
					type="button"
					onClick={() => setShowQuickActions((value) => !value)}
					aria-controls={quickActionsId}
					aria-expanded={showQuickActions}
					aria-label={showQuickActions ? "Hide quick actions" : "Show quick actions"}
					style={{
						padding: "10px 12px",
						borderRadius: "10px",
						border: "1px solid var(--color-border-secondary)",
						background: "var(--color-surface-secondary)",
						color: "var(--color-text-primary)",
						fontWeight: 700,
						cursor: "pointer",
					}}
				>
					{showQuickActions ? "Hide quick actions" : "Quick actions"}
				</button>
			</div>

			{showQuickActions && (
				<div
					id={quickActionsId}
					role="region"
					aria-label="Quick actions"
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
						gap: "10px",
						background: "var(--color-surface-secondary)",
						border: "1px solid var(--color-border-secondary)",
						borderRadius: "12px",
						padding: "10px",
						boxShadow: "0 10px 20px var(--color-shadow-lg)",
					}}
				>
					{quickActionError ? (
						<div style={{ gridColumn: "1 / -1" }}>
							<ActionErrorBanner
								message={quickActionError.message}
								actionLabel={quickActionError.actionLabel}
								onAction={quickActionError.onAction}
								onDismiss={() => setQuickActionError(null)}
							/>
						</div>
					) : null}
					{quickActions.map((action) => {
						const isPending = pendingAction === action.key;
						const shortcutLabel = action.shortcut ? `Shortcut: ${action.shortcut}` : undefined;

						return (
							<button
								key={action.key}
								type="button"
								aria-label={`${action.label} quick action`}
								aria-keyshortcuts={action.shortcut}
								aria-busy={isPending}
								onClick={() => void handleQuickAction(action)}
								disabled={isPending}
								title={shortcutLabel}
								style={{
									padding: "10px 12px",
									borderRadius: "10px",
									border: "1px solid var(--color-border-secondary)",
									background: isPending
										? "var(--color-surface-tertiary)"
										: "var(--color-surface-secondary)",
									color: "var(--color-text-primary)",
									fontWeight: 700,
									cursor: isPending ? "wait" : "pointer",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									gap: "8px",
									opacity: isPending ? 0.7 : 1,
								}}
							>
								<span>{action.icon}</span>
								{isPending ? "Working..." : action.label}
							</button>
						);
					})}
				</div>
			)}

			<section aria-labelledby={summaryHeadingId}>
				<h2 id={summaryHeadingId} style={visuallyHiddenStyle}>
					Dashboard summary
				</h2>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
						gap: "12px",
					}}
				>
					{summaryCards.map((card) => (
						<div
							key={card.label}
							role="group"
							aria-label={`${card.label}: ${card.value}`}
							style={{
								padding: "14px",
								borderRadius: "12px",
								border: "1px solid var(--color-border-secondary)",
								background: "var(--color-surface-secondary)",
								boxShadow: "0 10px 20px var(--color-shadow-lg)",
								minHeight: "78px",
								display: "flex",
								flexDirection: "column",
								gap: "6px",
							}}
						>
							<div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
								{card.icon} {card.label}
							</div>
							<div
								style={{
									fontWeight: 800,
									fontSize: "18px",
									color: card.accent,
									lineHeight: 1.2,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									transition: "transform 220ms ease, opacity 220ms ease, color 220ms ease",
									transform: isUpdating ? "translateY(-2px)" : "translateY(0)",
									opacity: isUpdating ? 0.75 : 1,
									willChange: "transform, opacity",
								}}
							>
								{card.value}
							</div>
						</div>
					))}
				</div>
			</section>

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
