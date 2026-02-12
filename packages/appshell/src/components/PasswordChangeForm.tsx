import { useAtom } from "jotai";
import { useState } from "react";
import { authAtom } from "../authAtoms.ts";

export function PasswordChangeForm() {
	const [auth] = useAtom(authAtom);
	const [isLoading, setIsLoading] = useState(false);
	const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
	const [formData, setFormData] = useState({
		currentPassword: "",
		newPassword: "",
		confirmPassword: "",
	});
	const [errors, setErrors] = useState<Record<string, string>>({});

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

		if (!formData.currentPassword) {
			newErrors.currentPassword = "Current password is required";
		}

		if (!formData.newPassword) {
			newErrors.newPassword = "New password is required";
		} else if (formData.newPassword.length < 8) {
			newErrors.newPassword = "Password must be at least 8 characters";
		} else if (!/[A-Z]/.test(formData.newPassword)) {
			newErrors.newPassword = "Password must contain at least one uppercase letter";
		} else if (!/[a-z]/.test(formData.newPassword)) {
			newErrors.newPassword = "Password must contain at least one lowercase letter";
		} else if (!/\d/.test(formData.newPassword)) {
			newErrors.newPassword = "Password must contain at least one number";
		} else if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(formData.newPassword)) {
			newErrors.newPassword = "Password must contain at least one special character";
		}

		if (!formData.confirmPassword) {
			newErrors.confirmPassword = "Please confirm your new password";
		} else if (formData.newPassword !== formData.confirmPassword) {
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
		setMessage(null);

		try {
			const response = await fetch("/api/auth/password", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${auth.token}`,
				},
				body: JSON.stringify({
					currentPassword: formData.currentPassword,
					newPassword: formData.newPassword,
				}),
			});

			const data = await response.json();

			if (response.ok) {
				setMessage({ type: "success", text: "Password changed successfully!" });
				setFormData({
					currentPassword: "",
					newPassword: "",
					confirmPassword: "",
				});
			} else {
				const errorMessage = data.error || "Failed to change password";
				setMessage({ type: "error", text: errorMessage });
			}
		} catch (_error) {
			setMessage({ type: "error", text: "Network error. Please try again." });
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div
			style={{
				maxWidth: "500px",
				margin: "0 auto",
				padding: "2rem",
				background: "#1f2937",
				borderRadius: "12px",
				boxShadow: "0 10px 25px rgba(0, 0, 0, 0.3)",
			}}
		>
			<h2
				style={{
					marginBottom: "2rem",
					color: "#f3f4f6",
					fontSize: "1.5rem",
					fontWeight: "600",
				}}
			>
				Change Password
			</h2>

			{message && (
				<div
					style={{
						padding: "0.75rem",
						background: message.type === "success" ? "#10b981" : "#ef4444",
						color: "white",
						borderRadius: "6px",
						marginBottom: "1rem",
						fontSize: "0.875rem",
					}}
				>
					{message.text}
				</div>
			)}

			<form
				onSubmit={handleSubmit}
				style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
			>
				<div>
					<label
						htmlFor="currentPassword"
						style={{
							display: "block",
							marginBottom: "0.5rem",
							color: "#d1d5db",
							fontSize: "0.875rem",
							fontWeight: "500",
						}}
					>
						Current Password
					</label>
					<input
						type="password"
						id="currentPassword"
						name="currentPassword"
						value={formData.currentPassword}
						onChange={handleChange}
						disabled={isLoading}
						style={{
							width: "100%",
							padding: "0.75rem",
							background: "#374151",
							border: errors.currentPassword ? "1px solid #ef4444" : "1px solid #4b5563",
							borderRadius: "6px",
							color: "#f3f4f6",
							fontSize: "0.875rem",
						}}
						placeholder="Enter your current password"
					/>
					{errors.currentPassword && (
						<div
							style={{
								color: "#ef4444",
								fontSize: "0.75rem",
								marginTop: "0.25rem",
							}}
						>
							{errors.currentPassword}
						</div>
					)}
				</div>

				<div>
					<label
						htmlFor="newPassword"
						style={{
							display: "block",
							marginBottom: "0.5rem",
							color: "#d1d5db",
							fontSize: "0.875rem",
							fontWeight: "500",
						}}
					>
						New Password
					</label>
					<input
						type="password"
						id="newPassword"
						name="newPassword"
						value={formData.newPassword}
						onChange={handleChange}
						disabled={isLoading}
						style={{
							width: "100%",
							padding: "0.75rem",
							background: "#374151",
							border: errors.newPassword ? "1px solid #ef4444" : "1px solid #4b5563",
							borderRadius: "6px",
							color: "#f3f4f6",
							fontSize: "0.875rem",
						}}
						placeholder="Enter your new password"
					/>
					{errors.newPassword && (
						<div
							style={{
								color: "#ef4444",
								fontSize: "0.75rem",
								marginTop: "0.25rem",
							}}
						>
							{errors.newPassword}
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
						Confirm New Password
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
						placeholder="Confirm your new password"
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
					{isLoading ? "Changing password..." : "Change Password"}
				</button>
			</form>

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
