import { CreateTaskForm } from "../../components/CreateTaskForm.tsx";
import { MobileCreateTaskForm } from "../../components/MobileCreateTaskForm.tsx";
import { SectionCard } from "../../components/SectionCard.tsx";

type CreateTaskSectionProps = {
	isMobile: boolean;
	isAuthenticated: boolean;
	showCreateForm: boolean;
	onToggle: () => void;
	onSuccess: () => void;
};

export function CreateTaskSection({
	isMobile,
	isAuthenticated,
	showCreateForm,
	onToggle,
	onSuccess,
}: CreateTaskSectionProps) {
	if (!isAuthenticated || !showCreateForm) return null;

	if (isMobile) {
		return (
			<section style={{ marginBottom: "16px" }}>
				<MobileCreateTaskForm
					onSuccess={() => {
						onSuccess();
						onToggle();
					}}
					onCancel={onToggle}
				/>
			</section>
		);
	}

	return (
		<section style={{ marginBottom: "16px" }}>
			<SectionCard title="Create New Task">
				<CreateTaskForm
					onSuccess={() => {
						onSuccess();
						onToggle();
					}}
				/>
			</SectionCard>
		</section>
	);
}
