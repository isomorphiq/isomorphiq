import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

interface LoginFormData {
	username: string;
	password: string;
}

interface LoginFormProps {
	onSuccess?: (user: { id: string; username: string; email: string }, token: string) => void;
	onError?: (error: string) => void;
}

export function LoginForm({ onSuccess, onError }: LoginFormProps) {
	const [formData, setFormData] = useState<LoginFormData>({
		username: "",
		password: "",
	});
	const [isLoading, setIsLoading] = useState(false);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const navigate = useNavigate();

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const { name, value } = e.target;
		setFormData((prev) => ({ ...prev, [name]: value }));
		// Clear error when user starts typing
		if (errors[name]) {
			setErrors((prev) => ({ ...prev, [name]: "" }));
		}
	};

	const validateForm = (): boolean => {
		const newErrors: Record<string, string> = {};

		if (!formData.username.trim()) {
			newErrors.username = "Username is required";
		}

		if (!formData.password) {
			newErrors.password = "Password is required";
		}

		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!validateForm()) {
			return;
		}

		setIsLoading(true);

		try {
			const response = await fetch("/api/auth/login", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(formData),
			});

			const data = await response.json();

			if (response.ok && data.token) {
				// Store token in localStorage
				localStorage.setItem("authToken", data.token);
				localStorage.setItem("user", JSON.stringify(data.user));

				onSuccess?.(data.user, data.token);
				navigate("/");
			} else {
				const errorMessage = data.error || "Login failed";
				setErrors({ form: errorMessage });
				onError?.(errorMessage);
			}
		} catch (_error) {
			const errorMessage = "Network error. Please try again.";
			setErrors({ form: errorMessage });
			onError?.(errorMessage);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div
			style={{
				maxWidth: "400px",
				margin: "0 auto",
				padding: "2rem",
				background: "#1f2937",
				borderRadius: "12px",
				boxShadow: "0 10px 25px rgba(0, 0, 0, 0.3)",
			}}
		>
			<h2
				style={{
					textAlign: "center",
					marginBottom: "2rem",
					color: "#f3f4f6",
					fontSize: "1.5rem",
					fontWeight: "600",
				}}
			>
				Sign In
			</h2>

			<form
				onSubmit={handleSubmit}
				style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
			>
				{errors.form && (
					<div
						style={{
							padding: "0.75rem",
							background: "#ef4444",
							color: "white",
							borderRadius: "6px",
							fontSize: "0.875rem",
						}}
					>
						{errors.form}
					</div>
				)}

				<div>
					<label
						htmlFor="username"
						style={{
							display: "block",
							marginBottom: "0.5rem",
							color: "#d1d5db",
							fontSize: "0.875rem",
							fontWeight: "500",
						}}
					>
						Username
					</label>
					<input
						type="text"
						id="username"
						name="username"
						value={formData.username}
						onChange={handleChange}
						disabled={isLoading}
						style={{
							width: "100%",
							padding: "0.75rem",
							background: "#374151",
							border: errors.username ? "1px solid #ef4444" : "1px solid #4b5563",
							borderRadius: "6px",
							color: "#f3f4f6",
							fontSize: "0.875rem",
						}}
						placeholder="Enter your username"
					/>
					{errors.username && (
						<div
							style={{
								color: "#ef4444",
								fontSize: "0.75rem",
								marginTop: "0.25rem",
							}}
						>
							{errors.username}
						</div>
					)}
				</div>

				<div>
					<label
						htmlFor="password"
						style={{
							display: "block",
							marginBottom: "0.5rem",
							color: "#d1d5db",
							fontSize: "0.875rem",
							fontWeight: "500",
						}}
					>
						Password
					</label>
					<input
						type="password"
						id="password"
						name="password"
						value={formData.password}
						onChange={handleChange}
						disabled={isLoading}
						style={{
							width: "100%",
							padding: "0.75rem",
							background: "#374151",
							border: errors.password ? "1px solid #ef4444" : "1px solid #4b5563",
							borderRadius: "6px",
							color: "#f3f4f6",
							fontSize: "0.875rem",
						}}
						placeholder="Enter your password"
					/>
					{errors.password && (
						<div
							style={{
								color: "#ef4444",
								fontSize: "0.75rem",
								marginTop: "0.25rem",
							}}
						>
							{errors.password}
						</div>
					)}
				</div>

				<button
					type="submit"
					disabled={isLoading}
					style={{
						padding: "0.75rem 1.5rem",
						background: isLoading ? "#6b7280" : "#3b82f6",
						color: "white",
						border: "none",
						borderRadius: "6px",
						fontSize: "0.875rem",
						fontWeight: "500",
						cursor: isLoading ? "not-allowed" : "pointer",
						transition: "background-color 0.2s ease",
					}}
				>
					{isLoading ? "Signing in..." : "Sign In"}
				</button>
			</form>

			<div
				style={{
					textAlign: "center",
					marginTop: "1.5rem",
					color: "#9ca3af",
					fontSize: "0.875rem",
				}}
			>
				Don't have an account?{" "}
				<Link
					to="/register"
					style={{
						color: "#3b82f6",
						textDecoration: "none",
						fontWeight: "500",
					}}
				>
					Sign up
				</Link>
			</div>
		</div>
	);
}
