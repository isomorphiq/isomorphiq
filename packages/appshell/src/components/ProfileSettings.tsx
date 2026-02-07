import { useAtom } from "jotai";
import { useState } from "react";
import { authAtom } from "../authAtoms.ts";

export function ProfileSettings() {
	const [auth, setAuth] = useAtom(authAtom);
	const [isLoading, setIsLoading] = useState(false);
	const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
	const [formData, setFormData] = useState({
		firstName: auth.user?.profile?.firstName || "",
		lastName: auth.user?.profile?.lastName || "",
		bio: auth.user?.profile?.bio || "",
		timezone: auth.user?.profile?.timezone || "UTC",
		language: auth.user?.profile?.language || "en",
		theme: auth.user?.preferences?.theme || "auto",
		emailNotifications: auth.user?.preferences?.notifications?.email ?? true,
		pushNotifications: auth.user?.preferences?.notifications?.push ?? true,
		taskAssignedNotifications: auth.user?.preferences?.notifications?.taskAssigned ?? true,
		taskCompletedNotifications: auth.user?.preferences?.notifications?.taskCompleted ?? false,
		taskOverdueNotifications: auth.user?.preferences?.notifications?.taskOverdue ?? true,
		defaultView: auth.user?.preferences?.dashboard?.defaultView || "list",
		itemsPerPage: auth.user?.preferences?.dashboard?.itemsPerPage || 25,
		showCompleted: auth.user?.preferences?.dashboard?.showCompleted ?? false,
	});

	const handleChange = (
		e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
	) => {
		const { name, value, type } = e.target;
		const checked = (e.target as HTMLInputElement).checked;

		setFormData((prev) => ({
			...prev,
			[name]: type === "checkbox" ? checked : value,
		}));
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);
		setMessage(null);

		try {
			const response = await fetch("/api/users/me/profile", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${auth.token}`,
				},
				body: JSON.stringify({
					profile: {
						firstName: formData.firstName || undefined,
						lastName: formData.lastName || undefined,
						bio: formData.bio || undefined,
						timezone: formData.timezone,
						language: formData.language,
					},
					preferences: {
						theme: formData.theme,
						notifications: {
							email: formData.emailNotifications,
							push: formData.pushNotifications,
							taskAssigned: formData.taskAssignedNotifications,
							taskCompleted: formData.taskCompletedNotifications,
							taskOverdue: formData.taskOverdueNotifications,
						},
						dashboard: {
							defaultView: formData.defaultView,
							itemsPerPage: formData.itemsPerPage,
							showCompleted: formData.showCompleted,
						},
					},
				}),
			});

			const data = await response.json();

			if (response.ok) {
				setAuth((prev) => ({
					...prev,
					user: data.user,
				}));
				setMessage({ type: "success", text: "Profile updated successfully!" });
			} else {
				setMessage({ type: "error", text: data.error || "Failed to update profile" });
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
				maxWidth: "800px",
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
				Profile Settings
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
				style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}
			>
				{/* Profile Information */}
				<section>
					<h3
						style={{
							color: "#d1d5db",
							fontSize: "1.125rem",
							fontWeight: "500",
							marginBottom: "1rem",
						}}
					>
						Profile Information
					</h3>
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
						<div>
							<label
								htmlFor="firstName"
								style={{
									display: "block",
									marginBottom: "0.5rem",
									color: "#9ca3af",
									fontSize: "0.875rem",
									fontWeight: "500",
								}}
							>
								First Name
							</label>
							<input
								type="text"
								id="firstName"
								name="firstName"
								value={formData.firstName}
								onChange={handleChange}
								disabled={isLoading}
								style={{
									width: "100%",
									padding: "0.75rem",
									background: "#374151",
									border: "1px solid #4b5563",
									borderRadius: "6px",
									color: "#f3f4f6",
									fontSize: "0.875rem",
								}}
							/>
						</div>
						<div>
							<label
								htmlFor="lastName"
								style={{
									display: "block",
									marginBottom: "0.5rem",
									color: "#9ca3af",
									fontSize: "0.875rem",
									fontWeight: "500",
								}}
							>
								Last Name
							</label>
							<input
								type="text"
								id="lastName"
								name="lastName"
								value={formData.lastName}
								onChange={handleChange}
								disabled={isLoading}
								style={{
									width: "100%",
									padding: "0.75rem",
									background: "#374151",
									border: "1px solid #4b5563",
									borderRadius: "6px",
									color: "#f3f4f6",
									fontSize: "0.875rem",
								}}
							/>
						</div>
					</div>
					<div>
						<label
							htmlFor="bio"
							style={{
								display: "block",
								marginBottom: "0.5rem",
								color: "#9ca3af",
								fontSize: "0.875rem",
								fontWeight: "500",
							}}
						>
							Bio
						</label>
						<textarea
							id="bio"
							name="bio"
							value={formData.bio}
							onChange={handleChange}
							disabled={isLoading}
							rows={3}
							style={{
								width: "100%",
								padding: "0.75rem",
								background: "#374151",
								border: "1px solid #4b5563",
								borderRadius: "6px",
								color: "#f3f4f6",
								fontSize: "0.875rem",
								resize: "vertical",
							}}
							placeholder="Tell us about yourself..."
						/>
					</div>
				</section>

				{/* Preferences */}
				<section>
					<h3
						style={{
							color: "#d1d5db",
							fontSize: "1.125rem",
							fontWeight: "500",
							marginBottom: "1rem",
						}}
					>
						Preferences
					</h3>
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
						<div>
							<label
								htmlFor="timezone"
								style={{
									display: "block",
									marginBottom: "0.5rem",
									color: "#9ca3af",
									fontSize: "0.875rem",
									fontWeight: "500",
								}}
							>
								Timezone
							</label>
							<select
								id="timezone"
								name="timezone"
								value={formData.timezone}
								onChange={handleChange}
								disabled={isLoading}
								style={{
									width: "100%",
									padding: "0.75rem",
									background: "#374151",
									border: "1px solid #4b5563",
									borderRadius: "6px",
									color: "#f3f4f6",
									fontSize: "0.875rem",
								}}
							>
								<option value="UTC">UTC</option>
								<option value="America/New_York">Eastern Time</option>
								<option value="America/Chicago">Central Time</option>
								<option value="America/Denver">Mountain Time</option>
								<option value="America/Los_Angeles">Pacific Time</option>
								<option value="Europe/London">London</option>
								<option value="Europe/Paris">Paris</option>
								<option value="Asia/Tokyo">Tokyo</option>
							</select>
						</div>
						<div>
							<label
								htmlFor="language"
								style={{
									display: "block",
									marginBottom: "0.5rem",
									color: "#9ca3af",
									fontSize: "0.875rem",
									fontWeight: "500",
								}}
							>
								Language
							</label>
							<select
								id="language"
								name="language"
								value={formData.language}
								onChange={handleChange}
								disabled={isLoading}
								style={{
									width: "100%",
									padding: "0.75rem",
									background: "#374151",
									border: "1px solid #4b5563",
									borderRadius: "6px",
									color: "#f3f4f6",
									fontSize: "0.875rem",
								}}
							>
								<option value="en">English</option>
								<option value="es">Spanish</option>
								<option value="fr">French</option>
								<option value="de">German</option>
								<option value="ja">Japanese</option>
							</select>
						</div>
					</div>
					<div style={{ marginTop: "1rem" }}>
						<label
							htmlFor="theme"
							style={{
								display: "block",
								marginBottom: "0.5rem",
								color: "#9ca3af",
								fontSize: "0.875rem",
								fontWeight: "500",
							}}
						>
							Theme
						</label>
						<select
							id="theme"
							name="theme"
							value={formData.theme}
							onChange={handleChange}
							disabled={isLoading}
							style={{
								width: "100%",
								padding: "0.75rem",
								background: "#374151",
								border: "1px solid #4b5563",
								borderRadius: "6px",
								color: "#f3f4f6",
								fontSize: "0.875rem",
							}}
						>
							<option value="light">Light</option>
							<option value="dark">Dark</option>
							<option value="auto">Auto</option>
						</select>
					</div>
				</section>

				{/* Notifications */}
				<section>
					<h3
						style={{
							color: "#d1d5db",
							fontSize: "1.125rem",
							fontWeight: "500",
							marginBottom: "1rem",
						}}
					>
						Notifications
					</h3>
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
						{[
							{ key: "emailNotifications", label: "Email Notifications" },
							{ key: "pushNotifications", label: "Push Notifications" },
							{ key: "taskAssignedNotifications", label: "Task Assigned" },
							{ key: "taskCompletedNotifications", label: "Task Completed" },
							{ key: "taskOverdueNotifications", label: "Task Overdue" },
						].map(({ key, label }) => (
							<div key={key} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
								<input
									type="checkbox"
									id={key}
									name={key}
									checked={formData[key as keyof typeof formData] as boolean}
									onChange={handleChange}
									disabled={isLoading}
									style={{
										width: "1rem",
										height: "1rem",
										accentColor: "#3b82f6",
									}}
								/>
								<label
									htmlFor={key}
									style={{
										color: "#9ca3af",
										fontSize: "0.875rem",
										cursor: "pointer",
									}}
								>
									{label}
								</label>
							</div>
						))}
					</div>
				</section>

				{/* Dashboard Settings */}
				<section>
					<h3
						style={{
							color: "#d1d5db",
							fontSize: "1.125rem",
							fontWeight: "500",
							marginBottom: "1rem",
						}}
					>
						Dashboard Settings
					</h3>
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
						<div>
							<label
								htmlFor="defaultView"
								style={{
									display: "block",
									marginBottom: "0.5rem",
									color: "#9ca3af",
									fontSize: "0.875rem",
									fontWeight: "500",
								}}
							>
								Default View
							</label>
							<select
								id="defaultView"
								name="defaultView"
								value={formData.defaultView}
								onChange={handleChange}
								disabled={isLoading}
								style={{
									width: "100%",
									padding: "0.75rem",
									background: "#374151",
									border: "1px solid #4b5563",
									borderRadius: "6px",
									color: "#f3f4f6",
									fontSize: "0.875rem",
								}}
							>
								<option value="list">List</option>
								<option value="kanban">Kanban</option>
								<option value="calendar">Calendar</option>
							</select>
						</div>
						<div>
							<label
								htmlFor="itemsPerPage"
								style={{
									display: "block",
									marginBottom: "0.5rem",
									color: "#9ca3af",
									fontSize: "0.875rem",
									fontWeight: "500",
								}}
							>
								Items Per Page
							</label>
							<input
								type="number"
								id="itemsPerPage"
								name="itemsPerPage"
								min="5"
								max="100"
								value={formData.itemsPerPage}
								onChange={handleChange}
								disabled={isLoading}
								style={{
									width: "100%",
									padding: "0.75rem",
									background: "#374151",
									border: "1px solid #4b5563",
									borderRadius: "6px",
									color: "#f3f4f6",
									fontSize: "0.875rem",
								}}
							/>
						</div>
					</div>
					<div style={{ marginTop: "1rem" }}>
						<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
							<input
								type="checkbox"
								id="showCompleted"
								name="showCompleted"
								checked={formData.showCompleted}
								onChange={handleChange}
								disabled={isLoading}
								style={{
									width: "1rem",
									height: "1rem",
									accentColor: "#3b82f6",
								}}
							/>
							<label
								htmlFor="showCompleted"
								style={{
									color: "#9ca3af",
									fontSize: "0.875rem",
									cursor: "pointer",
								}}
							>
								Show completed tasks by default
							</label>
						</div>
					</div>
				</section>

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
						alignSelf: "flex-start",
					}}
				>
					{isLoading ? "Saving..." : "Save Changes"}
				</button>
			</form>
		</div>
	);
}
