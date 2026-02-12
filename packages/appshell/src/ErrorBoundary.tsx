import React from "react";

type Props = {
	children: React.ReactNode;
	fallback?: React.ReactNode;
};

type State = {
	hasError: boolean;
	error: Error | null;
};

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class ErrorBoundary extends React.Component<Props, State> {
	state: State = { hasError: false, error: null };

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo): void {
		console.error("[UI] Uncaught error:", error, info);
	}

	handleReset = () => {
		this.setState({ hasError: false, error: null });
		window.location.reload();
	};

	render() {
		if (this.state.hasError) {
			return (
				this.props.fallback ?? (
					<div
						style={{ padding: "24px", background: "#0f172a", color: "#e2e8f0", minHeight: "100vh" }}
					>
						<h2 style={{ margin: 0, fontSize: "20px" }}>Something went wrong</h2>
						<p style={{ color: "#94a3b8" }}>{this.state.error?.message}</p>
						<button
							type="button"
							onClick={this.handleReset}
							style={{
								marginTop: "12px",
								padding: "10px 14px",
								background: "#2563eb",
								color: "#fff",
								border: "none",
								borderRadius: "6px",
								cursor: "pointer",
							}}
						>
							Reload
						</button>
					</div>
				)
			);
		}
		return this.props.children;
	}
}

