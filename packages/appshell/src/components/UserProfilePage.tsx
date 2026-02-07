import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { authAtom } from "../authAtoms.ts";
import { Header, Layout } from "./Layout";
import { SectionCard } from "./SectionCard";

type ProfileForm = {
	firstName?: string;
	lastName?: string;
	bio?: string;
	timezone?: string;
	language?: string;
};

type PreferencesForm = {
	theme?: "light" | "dark" | "auto";
	notifications?: {
		email?: boolean;
		push?: boolean;
		taskAssigned?: boolean;
		taskCompleted?: boolean;
		taskOverdue?: boolean;
	};
};

export function UserProfilePage() {
	const [auth, setAuth] = useAtom(authAtom);
	const [profile, setProfile] = useState<ProfileForm>({});
	const [preferences, setPreferences] = useState<PreferencesForm>({});
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	// Load current user
	useEffect(() => {
		const load = async () => {
			if (!auth.token) return;
			try {
				const resp = await fetch("/api/users/me", {
					headers: { Authorization: `Bearer ${auth.token}` },
				});
				if (!resp.ok) throw new Error("Failed to load profile");
				const data = await resp.json();
				const user = data.user;
				setAuth((prev) => ({ ...prev, user }));
				setProfile({
					firstName: user.profile?.firstName ?? "",
					lastName: user.profile?.lastName ?? "",
					bio: user.profile?.bio ?? "",
					timezone: user.profile?.timezone ?? "",
					language: user.profile?.language ?? "",
				});
				setPreferences({
					theme: user.preferences?.theme ?? "auto",
					notifications: {
						email: user.preferences?.notifications?.email ?? true,
						push: user.preferences?.notifications?.push ?? false,
						taskAssigned: user.preferences?.notifications?.taskAssigned ?? true,
						taskCompleted: user.preferences?.notifications?.taskCompleted ?? true,
						taskOverdue: user.preferences?.notifications?.taskOverdue ?? true,
					},
				});
			} catch (err) {
				console.error(err);
				setError("Unable to load profile");
			}
		};
		void load();
	}, [auth.token, setAuth]);

	const handleSave = async () => {
		setLoading(true);
		setError(null);
		setSuccess(null);
		try {
			const resp = await fetch("/api/users/me/profile", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${auth.token}`,
				},
				body: JSON.stringify({ profile, preferences }),
			});
			const data = await resp.json();
			if (!resp.ok) throw new Error(data.error || "Failed to update profile");

			// Persist user
			localStorage.setItem("user", JSON.stringify(data.user));
			setAuth((prev) => ({ ...prev, user: data.user }));
			setSuccess("Profile updated");
		} catch (err: unknown) {
			setError((err as Error)?.message ?? "Update failed");
		} finally {
			setLoading(false);
		}
	};

	const onProfileChange = (key: keyof ProfileForm, value: string) =>
		setProfile((p) => ({ ...p, [key]: value }));

	const onNotificationChange = (
		key: keyof NonNullable<PreferencesForm["notifications"]>,
		value: boolean,
	) =>
		setPreferences((p) => ({
			...p,
			notifications: { ...(p.notifications ?? {}), [key]: value },
		}));

	return (
		<Layout>
			<Header title="My Profile" subtitle="Manage your account details" showAuthControls={false} />
			<nav style={{ marginBottom: "12px" }}>
				<Link to="/" style={{ color: "#93c5fd" }}>
					← Back to dashboard
				</Link>
			</nav>

			<div style={{ display: "grid", gap: "12px", gridTemplateColumns: "1.2fr 1fr" }}>
				<SectionCard title="Profile">
					{error && (
						<div
							style={{ background: "#ef4444", padding: "8px", borderRadius: "8px", color: "white" }}
						>
							{error}
						</div>
					)}
					{success && (
						<div
							style={{
								background: "#22c55e",
								padding: "8px",
								borderRadius: "8px",
								color: "#0f172a",
								fontWeight: 700,
							}}
						>
							{success}
						</div>
					)}
					<div style={{ display: "grid", gap: "10px" }}>
						<label style={{ display: "grid", gap: "4px" }}>
							<span style={{ color: "#cbd5e1" }}>First name</span>
							<input
								value={profile.firstName ?? ""}
								onChange={(e) => onProfileChange("firstName", e.target.value)}
								style={inputStyle}
							/>
						</label>
						<label style={{ display: "grid", gap: "4px" }}>
							<span style={{ color: "#cbd5e1" }}>Last name</span>
							<input
								value={profile.lastName ?? ""}
								onChange={(e) => onProfileChange("lastName", e.target.value)}
								style={inputStyle}
							/>
						</label>
						<label style={{ display: "grid", gap: "4px" }}>
							<span style={{ color: "#cbd5e1" }}>Bio</span>
							<textarea
								value={profile.bio ?? ""}
								onChange={(e) => onProfileChange("bio", e.target.value)}
								style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}
							/>
						</label>
						<label style={{ display: "grid", gap: "4px" }}>
							<span style={{ color: "#cbd5e1" }}>Timezone</span>
							<input
								value={profile.timezone ?? ""}
								onChange={(e) => onProfileChange("timezone", e.target.value)}
								style={inputStyle}
								placeholder="e.g. America/Los_Angeles"
							/>
						</label>
						<label style={{ display: "grid", gap: "4px" }}>
							<span style={{ color: "#cbd5e1" }}>Language</span>
							<input
								value={profile.language ?? ""}
								onChange={(e) => onProfileChange("language", e.target.value)}
								style={inputStyle}
								placeholder="e.g. en-US"
							/>
						</label>
					</div>
				</SectionCard>

				<SectionCard title="Preferences">
					<div style={{ display: "grid", gap: "10px" }}>
						<label style={{ display: "grid", gap: "4px" }}>
							<span style={{ color: "#cbd5e1" }}>Theme</span>
							<select
								value={preferences.theme ?? "auto"}
								onChange={(e) =>
									setPreferences((p) => ({
										...p,
										theme: e.target.value as PreferencesForm["theme"],
									}))
								}
								style={inputStyle}
							>
								<option value="auto">Auto</option>
								<option value="light">Light</option>
								<option value="dark">Dark</option>
							</select>
						</label>

						<div style={{ color: "#cbd5e1", fontWeight: 600, marginTop: "4px" }}>Notifications</div>
						{[
							["email", "Email alerts"],
							["push", "Push notifications"],
							["taskAssigned", "Task assigned"],
							["taskCompleted", "Task completed"],
							["taskOverdue", "Task overdue"],
						].map(([key, label]) => (
							<label
								key={key}
								style={{ display: "flex", alignItems: "center", gap: "8px", color: "#e2e8f0" }}
							>
								<input
									type="checkbox"
									checked={Boolean(
										preferences.notifications?.[key as keyof PreferencesForm["notifications"]],
									)}
									onChange={(e) =>
										onNotificationChange(
											key as keyof PreferencesForm["notifications"],
											e.target.checked,
										)
									}
								/>
								<span>{label}</span>
							</label>
						))}
					</div>
				</SectionCard>
			</div>

			<div style={{ marginTop: "12px" }}>
				<button
					type="button"
					onClick={handleSave}
					disabled={loading}
					style={{
						background: "#2563eb",
						color: "white",
						padding: "10px 16px",
						border: "none",
						borderRadius: "10px",
						fontWeight: 700,
						cursor: loading ? "not-allowed" : "pointer",
						boxShadow: "0 8px 18px rgba(37,99,235,0.35)",
					}}
				>
					{loading ? "Saving..." : "Save changes"}
				</button>
			</div>
		</Layout>
	);
}

const inputStyle: React.CSSProperties = {
	background: "#0b1220",
	border: "1px solid #1f2937",
	color: "#e2e8f0",
	borderRadius: "8px",
	padding: "10px",
};
