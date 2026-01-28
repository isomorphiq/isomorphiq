import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from "react";

type CardProps = {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
};

const cardBaseStyle: CSSProperties = {
	background: "var(--color-surface-primary)",
	border: "1px solid var(--color-border-primary)",
	borderRadius: "12px",
	boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12)",
};

const cardSectionStyle: CSSProperties = {
	padding: "16px",
};

export function Card({ children, className, style }: CardProps) {
	return (
		<div className={className} style={{ ...cardBaseStyle, ...style }}>
			{children}
		</div>
	);
}

export function CardHeader({ children, className, style }: CardProps) {
	return (
		<div
			className={className}
			style={{
				...cardSectionStyle,
				borderBottom: "1px solid var(--color-border-primary)",
				...style,
			}}
		>
			{children}
		</div>
	);
}

export function CardContent({ children, className, style }: CardProps) {
	return (
		<div className={className} style={{ ...cardSectionStyle, ...style }}>
			{children}
		</div>
	);
}

export function CardTitle({ children, className, style }: CardProps) {
	return (
		<h3 className={className} style={{ margin: 0, fontSize: "16px", ...style }}>
			{children}
		</h3>
	);
}

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
	onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
	hasError: boolean;
	error?: Error;
	errorInfo?: ErrorInfo;
}

export class EnhancedErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error("Error caught by boundary:", error, errorInfo);

		this.setState({ error, errorInfo });

		if (this.props.onError) {
			this.props.onError(error, errorInfo);
		}
	}

	handleReset = () => {
		this.setState({ hasError: false, error: undefined, errorInfo: undefined });
	};

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}

			return (
				<div
					style={{
						padding: "40px",
						borderRadius: "12px",
						background: "var(--color-surface-primary)",
						border: "1px solid var(--color-accent-error)",
						margin: "20px",
						textAlign: "center",
					}}
				>
					<div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
					<h2
						style={{
							color: "var(--color-accent-error)",
							marginBottom: "16px",
							fontSize: "24px",
						}}
					>
						Something went wrong
					</h2>

					<p
						style={{
							color: "var(--color-accent-error)",
							opacity: 0.8,
							marginBottom: "24px",
							lineHeight: "1.5",
						}}
					>
						{this.state.error?.message || "An unexpected error occurred"}
					</p>

					{process.env.NODE_ENV === "development" && this.state.errorInfo && (
						<details
							style={{
								textAlign: "left",
								marginBottom: "24px",
								padding: "16px",
								background: "var(--color-surface-tertiary)",
								borderRadius: "8px",
								border: "1px solid var(--color-border-primary)",
							}}
						>
							<summary
								style={{
									color: "var(--color-text-primary)",
									cursor: "pointer",
									marginBottom: "8px",
								}}
							>
								Error Details (Development Only)
							</summary>
							<pre
								style={{
									color: "var(--color-text-secondary)",
									fontSize: "12px",
									overflow: "auto",
									whiteSpace: "pre-wrap",
								}}
							>
								{this.state.error?.stack}
								{"\n\n"}
								Component Stack:
								{this.state.errorInfo.componentStack}
							</pre>
						</details>
					)}

					<div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
						<button
							type="button"
							onClick={this.handleReset}
							style={{
								padding: "12px 24px",
								borderRadius: "8px",
								border: "1px solid var(--color-accent-primary)",
								background: "var(--color-accent-primary)",
								color: "white",
								fontSize: "14px",
								fontWeight: "500",
								cursor: "pointer",
							}}
						>
							Try Again
						</button>

						<button
							type="button"
							onClick={() => window.location.reload()}
							style={{
								padding: "12px 24px",
								borderRadius: "8px",
								border: "1px solid var(--color-border-primary)",
								background: "var(--color-surface-primary)",
								color: "var(--color-text-primary)",
								fontSize: "14px",
								cursor: "pointer",
							}}
						>
							Reload Page
						</button>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}

// Loading Spinner Component
interface LoadingSpinnerProps {
	size?: "small" | "medium" | "large";
	message?: string;
	overlay?: boolean;
}

export function LoadingSpinner({
	size = "medium",
	message = "Loading...",
	overlay = false,
}: LoadingSpinnerProps) {
	const sizeMap = {
		small: { width: "20px", height: "20px", border: "2px" },
		medium: { width: "32px", height: "32px", border: "3px" },
		large: { width: "48px", height: "48px", border: "4px" },
	};

	const spinnerSize = sizeMap[size];

	const spinner = (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: "12px",
			}}
		>
			<div
				style={{
					width: spinnerSize.width,
					height: spinnerSize.height,
					border: `${spinnerSize.border} solid var(--color-border-primary)`,
					borderTop: `${spinnerSize.border} solid var(--color-accent-primary)`,
					borderRadius: "50%",
					animation: "spin 1s linear infinite",
				}}
			/>
			{message && (
				<div
					style={{
						color: "var(--color-text-muted)",
						fontSize: "14px",
						fontWeight: "500",
					}}
				>
					{message}
				</div>
			)}
		</div>
	);

	if (overlay) {
		return (
			<div
				style={{
					position: "fixed",
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					background: "rgba(0, 0, 0, 0.5)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					zIndex: 9999,
				}}
			>
				{spinner}
			</div>
		);
	}

	return spinner;
}

// Loading Skeleton Component
interface LoadingSkeletonProps {
	width?: string | number;
	height?: string | number;
	lines?: number;
	variant?: "text" | "rectangular" | "circular";
}

export function LoadingSkeleton({
	width = "100%",
	height = "20px",
	lines = 1,
	variant = "text",
}: LoadingSkeletonProps) {
	const getSkeletonStyle = () => {
		const baseStyle = {
			width: typeof width === "number" ? `${width}px` : width,
			height: typeof height === "number" ? `${height}px` : height,
			background: "linear-gradient(90deg, var(--color-border-primary) 25%, var(--color-border-secondary) 50%, var(--color-border-primary) 75%)",
			backgroundSize: "200% 100%",
			animation: "shimmer 1.5s infinite",
			borderRadius: variant === "circular" ? "50%" : variant === "text" ? "4px" : "8px",
		};
		return baseStyle;
	};

	if (variant === "text" && lines > 1) {
		return (
			<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
				{Array.from({ length: lines }).map((_, index) => (
					<div
						key={`skeleton-line-${index}-${lines}`}
						style={{
							...getSkeletonStyle(),
							width: index === lines - 1 ? "70%" : "100%", // Last line shorter
						}}
					/>
				))}
			</div>
		);
	}

	return <div style={getSkeletonStyle()} />;
}

// Empty State Component
interface EmptyStateProps {
	icon?: string;
	title: string;
	description?: string;
	action?: {
		label: string;
		onClick: () => void;
	};
}

export function EmptyState({ icon = "📭", title, description, action }: EmptyStateProps) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				padding: "60px 20px",
				textAlign: "center",
				color: "var(--color-text-muted)",
			}}
		>
			<div style={{ fontSize: "48px", marginBottom: "16px", opacity: 0.7 }}>{icon}</div>

			<h3
				style={{
					margin: "0 0 8px 0",
					color: "var(--color-text-primary)",
					fontSize: "18px",
					fontWeight: "500",
				}}
			>
				{title}
			</h3>

			{description && (
				<p
					style={{
						margin: "0 0 24px 0",
						lineHeight: "1.5",
						maxWidth: "400px",
					}}
				>
					{description}
				</p>
			)}

			{action && (
				<button
					type="button"
					onClick={action.onClick}
					style={{
						padding: "12px 24px",
						borderRadius: "8px",
						border: "1px solid var(--color-accent-primary)",
						background: "var(--color-accent-primary)",
						color: "white",
						fontSize: "14px",
						fontWeight: "500",
						cursor: "pointer",
					}}
				>
					{action.label}
				</button>
			)}
		</div>
	);
}

// Retry Component
interface RetryProps {
	error?: string;
	onRetry: () => void;
	retryCount?: number;
}

export function Retry({ error, onRetry, retryCount = 0 }: RetryProps) {
	return (
		<div
			style={{
				padding: "20px",
				borderRadius: "8px",
				background: "var(--color-surface-primary)",
				border: "1px solid var(--color-accent-error)",
				textAlign: "center",
			}}
		>
			<div style={{ fontSize: "24px", marginBottom: "12px" }}>⚠️</div>

			<h4
				style={{
					margin: "0 0 8px 0",
					color: "var(--color-accent-error)",
					fontSize: "16px",
				}}
			>
				Something went wrong
			</h4>

			{error && (
				<p
					style={{
						margin: "0 0 16px 0",
						color: "var(--color-accent-error)",
						opacity: 0.8,
						fontSize: "14px",
					}}
				>
					{error}
				</p>
			)}

			<button
				type="button"
				onClick={onRetry}
				style={{
					padding: "8px 16px",
					borderRadius: "6px",
					border: "1px solid var(--color-accent-primary)",
					background: "var(--color-accent-primary)",
					color: "white",
					fontSize: "14px",
					cursor: "pointer",
				}}
			>
				Retry {retryCount > 0 && `(${retryCount})`}
			</button>
		</div>
	);
}

// Add animations
const style = document.createElement("style");
style.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
`;
if (!document.head.querySelector("style[data-ui-components]")) {
	style.setAttribute("data-ui-components", "true");
	document.head.appendChild(style);
}
