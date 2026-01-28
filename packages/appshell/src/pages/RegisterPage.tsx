import { Link } from "react-router-dom";
import { RegisterForm } from "../components/RegisterForm.tsx";
import { useRegistrationStatus } from "../hooks/useRegistrationStatus.ts";

export function RegisterPage() {
	const { registrationDisabled } = useRegistrationStatus();

	return (
		<div
			style={{
				minHeight: "100vh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background:
					"radial-gradient(circle at 20% 20%, #e0f2fe 0, transparent 25%), radial-gradient(circle at 80% 10%, #f3e8ff 0, transparent 28%), radial-gradient(circle at 60% 70%, #d1fae5 0, transparent 30%), #0b1220",
				padding: "1.5rem",
			}}
		>
			<div
				style={{
					width: "100%",
					maxWidth: "480px",
					background: "#0f172a",
					border: "1px solid #1f2937",
					borderRadius: "16px",
					padding: "24px",
					boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
					color: "#e2e8f0",
				}}
			>
				<h1 style={{ margin: 0, fontSize: "26px", letterSpacing: "-0.5px" }}>
					Create your account
				</h1>
				<p style={{ margin: "6px 0 18px", color: "#94a3b8" }}>
					Access the dashboard, live workflow graph, and task updates in real time.
				</p>
				<div style={{ marginBottom: "12px" }}>
					<Link
						to="/"
						style={{
							color: "#38bdf8",
							textDecoration: "none",
							fontWeight: 600,
						}}
					>
						← Back to dashboard
					</Link>
				</div>
				{registrationDisabled ? (
					<div
						style={{
							background: "#111827",
							border: "1px solid #1f2937",
							borderRadius: "10px",
							padding: "14px",
							color: "#cbd5e1",
							fontSize: "14px",
							lineHeight: 1.5,
						}}
					>
						<h2 style={{ margin: "0 0 8px 0", fontSize: "18px" }}>Signups are closed</h2>
						<p style={{ margin: 0 }}>
							We are in private beta and are not accepting new registrations right now. Please check
							back soon.
						</p>
					</div>
				) : (
					<RegisterForm />
				)}
				<div style={{ marginTop: "12px", fontSize: "14px", color: "#94a3b8" }}>
					Already have an account?{" "}
					<Link to="/login" style={{ color: "#38bdf8" }}>
						Login
					</Link>
				</div>
			</div>
		</div>
	);
}
