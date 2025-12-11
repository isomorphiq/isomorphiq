import { Header, Layout } from "../components/Layout.tsx";
import { PasswordChangeForm } from "../components/PasswordChangeForm.tsx";

export function SecurityPage() {
	return (
		<Layout>
			<Header title="Security" subtitle="Manage your password and security settings" />
			<div style={{ padding: "1rem" }}>
				<PasswordChangeForm />
			</div>
		</Layout>
	);
}
