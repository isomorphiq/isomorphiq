import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { authAtom } from "../authAtoms.ts";
import { Header, Layout } from "../components/Layout.tsx";
import { PasswordChangeForm } from "../components/PasswordChangeForm.tsx";
import { SectionCard } from "../components/SectionCard.tsx";

type AdminSettings = {
	registrationEnabled: boolean;
	allowNonAdminWrites: boolean;
};

export function SecurityPage() {
	const [auth] = useAtom(authAtom);
	const isAdmin = auth.user?.username === "nyan";
	const [adminSettings, setAdminSettings] = useState<AdminSettings>({
		registrationEnabled: false,
		allowNonAdminWrites: false,
	});
	const [adminError, setAdminError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		const fetchSettings = async () => {
			if (!isAdmin || !auth.token) return;
			try {
				const response = await fetch("/api/admin/settings", {
					headers: {
						Authorization: `Bearer ${auth.token}`,
					},
				});
				const data = await response.json();
				if (response.ok && data?.settings) {
					setAdminSettings(data.settings as AdminSettings);
					setAdminError(null);
				} else {
					setAdminError(data.error || "Failed to load admin settings");
				}
			} catch (error) {
				console.error("Failed to load admin settings", error);
				setAdminError("Failed to load admin settings");
			}
		};
		fetchSettings();
	}, [auth.token, isAdmin]);

	const updateSettings = async (patch: Partial<AdminSettings>) => {
		if (!isAdmin || !auth.token) return;
		setIsSaving(true);
		try {
			const response = await fetch("/api/admin/settings", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${auth.token}`,
				},
				body: JSON.stringify(patch),
			});
			const data = await response.json();
			if (response.ok && data?.settings) {
				setAdminSettings(data.settings as AdminSettings);
				setAdminError(null);
			} else {
				setAdminError(data.error || "Failed to update admin settings");
			}
		} catch (error) {
			console.error("Failed to update admin settings", error);
			setAdminError("Failed to update admin settings");
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<Layout>
			<Header title="Security" subtitle="Manage your password and security settings" />
			<div style={{ padding: "1rem", display: "grid", gap: "16px", maxWidth: "960px" }}>
				<SectionCard
					title={isAdmin ? "Admin controls" : "Read-only mode"}
					countLabel={isAdmin ? "Only nyan can change these" : undefined}
				>
					{isAdmin ? (
						<div style={{ display: "grid", gap: "12px" }}>
							<label
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: "12px",
									fontWeight: 600,
								}}
							>
								<span>Allow user registration</span>
								<input
									type="checkbox"
									checked={adminSettings.registrationEnabled}
									onChange={(e) => updateSettings({ registrationEnabled: e.target.checked })}
									disabled={isSaving}
								/>
							</label>
							<label
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: "12px",
									fontWeight: 600,
								}}
							>
								<span>Allow non-admin writes</span>
								<input
									type="checkbox"
									checked={adminSettings.allowNonAdminWrites}
									onChange={(e) =>
										updateSettings({ allowNonAdminWrites: e.target.checked })
									}
									disabled={isSaving}
								/>
							</label>
							{adminError && (
								<div style={{ color: "var(--color-accent-error)", fontSize: "12px" }}>
									{adminError}
								</div>
							)}
							{isSaving && (
								<div style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>
									Saving admin settings...
								</div>
							)}
						</div>
					) : (
						<p style={{ margin: 0, color: "var(--color-text-muted)" }}>
							You are in read-only mode. Only the admin user nyan can change system settings or
							write data.
						</p>
					)}
				</SectionCard>

				{isAdmin ? (
					<PasswordChangeForm />
				) : (
					<SectionCard title="Password">
						<p style={{ margin: 0, color: "var(--color-text-muted)" }}>
							Password changes are disabled while the system is in admin-only write mode.
						</p>
					</SectionCard>
				)}
			</div>
		</Layout>
	);
}
