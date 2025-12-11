import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

interface RegisterFormData {
	username: string;
	email: string;
	password: string;
	confirmPassword: string;
}

interface RegisterFormProps {
	onSuccess?: (user: { id: string; username: string; email: string }) => void;
	onError?: (error: string) => void;
}

export function RegisterForm({ onSuccess, onError }: RegisterFormProps) {
	const [formData, setFormData] = useState<RegisterFormData>({
		username: "",
		email: "",
		password: "",
		confirmPassword: "",
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
		} else if (formData.username.length < 3) {
			newErrors.username = "Username must be at least 3 characters";
		} else if (formData.username.length > 50) {
			newErrors.username = "Username must be less than 50 characters";
		} else if (!/^[a-zA-Z0-9_-]+$/.test(formData.username)) {
			newErrors.username = "Username can only contain letters, numbers, underscores, and hyphens";
		}

		if (!formData.email.trim()) {
			newErrors.email = "Email is required";
		} else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
			newErrors.email = "Invalid email format";
		}

		if (!formData.password) {
			newErrors.password = "Password is required";
		} else if (formData.password.length < 8) {
			newErrors.password = "Password must be at least 8 characters";
		} else if (!/[A-Z]/.test(formData.password)) {
			newErrors.password = "Password must contain at least one uppercase letter";
		} else if (!/[a-z]/.test(formData.password)) {
			newErrors.password = "Password must contain at least one lowercase letter";
		} else if (!/\d/.test(formData.password)) {
			newErrors.password = "Password must contain at least one number";
		} else if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(formData.password)) {
			newErrors.password = "Password must contain at least one special character";
		}

		if (!formData.confirmPassword) {
			newErrors.confirmPassword = "Please confirm your password";
		} else if (formData.password !== formData.confirmPassword) {
			newErrors.confirmPassword = "Passwords do not match";
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
			const response = await fetch("/api/auth/register", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					username: formData.username,
					email: formData.email,
					password: formData.password,
					role: "developer", // Default role
				}),
			});

			const data = await response.json();

			if (response.ok && data.token) {
				localStorage.setItem("authToken", data.token);
				localStorage.setItem("user", JSON.stringify(data.user));
				onSuccess?.(data.user);
				navigate("/");
			} else {
				const errorMessage = data.error || "Registration failed";
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
				Create Account
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
						placeholder="Choose a username"
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
						htmlFor="email"
						style={{
							display: "block",
							marginBottom: "0.5rem",
							color: "#d1d5db",
							fontSize: "0.875rem",
							fontWeight: "500",
						}}
					>
						Email
					</label>
					<input
						type="email"
						id="email"
						name="email"
						value={formData.email}
						onChange={handleChange}
						disabled={isLoading}
						style={{
							width: "100%",
							padding: "0.75rem",
							background: "#374151",
							border: errors.email ? "1px solid #ef4444" : "1px solid #4b5563",
							borderRadius: "6px",
							color: "#f3f4f6",
							fontSize: "0.875rem",
						}}
						placeholder="Enter your email"
					/>
					{errors.email && (
						<div
							style={{
								color: "#ef4444",
								fontSize: "0.75rem",
								marginTop: "0.25rem",
							}}
						>
							{errors.email}
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
						placeholder="Create a strong password"
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

				<div>
					<label
						htmlFor="confirmPassword"
						style={{
							display: "block",
							marginBottom: "0.5rem",
							color: "#d1d5db",
							fontSize: "0.875rem",
							fontWeight: "500",
						}}
					>
						Confirm Password
					</label>
					<input
						type="password"
						id="confirmPassword"
						name="confirmPassword"
						value={formData.confirmPassword}
						onChange={handleChange}
						disabled={isLoading}
						style={{
							width: "100%",
							padding: "0.75rem",
							background: "#374151",
							border: errors.confirmPassword ? "1px solid #ef4444" : "1px solid #4b5563",
							borderRadius: "6px",
							color: "#f3f4f6",
							fontSize: "0.875rem",
						}}
						placeholder="Confirm your password"
					/>
					{errors.confirmPassword && (
						<div
							style={{
								color: "#ef4444",
								fontSize: "0.75rem",
								marginTop: "0.25rem",
							}}
						>
							{errors.confirmPassword}
						</div>
					)}
				</div>

				<button
					type="submit"
					disabled={isLoading}
					style={{
						padding: "0.75rem 1.5rem",
						background: isLoading ? "#6b7280" : "#10b981",
						color: "white",
						border: "none",
						borderRadius: "6px",
						fontSize: "0.875rem",
						fontWeight: "500",
						cursor: isLoading ? "not-allowed" : "pointer",
						transition: "background-color 0.2s ease",
					}}
				>
					{isLoading ? "Creating account..." : "Create Account"}
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
				Already have an account?{" "}
				<Link
					to="/login"
					style={{
						color: "#3b82f6",
						textDecoration: "none",
						fontWeight: "500",
					}}
				>
					Sign in
				</Link>
			</div>

			<div
				style={{
					marginTop: "1rem",
					padding: "1rem",
					background: "#374151",
					borderRadius: "6px",
					fontSize: "0.75rem",
					color: "#9ca3af",
				}}
			>
				<div style={{ fontWeight: "500", marginBottom: "0.5rem", color: "#d1d5db" }}>
					Password requirements:
				</div>
				<ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
					<li>At least 8 characters</li>
					<li>One uppercase letter</li>
					<li>One lowercase letter</li>
					<li>One number</li>
					<li>One special character</li>
				</ul>
			</div>
		</div>
	);
}
