import { LoginForm } from "../components/LoginForm.tsx";

export function LoginPage() {
	return (
		<div
			style={{
				minHeight: "100vh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
				padding: "1rem",
			}}
		>
			<LoginForm />
		</div>
	);
}
