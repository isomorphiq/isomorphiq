import { CreateTaskForm } from "../../components/CreateTaskForm.tsx";
import { SectionCard } from "../../components/SectionCard.tsx";

type CreateTaskSectionProps = {
	isAuthenticated: boolean;
	showCreateForm: boolean;
	onToggle: () => void;
	onSuccess: () => void;
};

export function CreateTaskSection({
	isAuthenticated,
	showCreateForm,
	onToggle,
	onSuccess,
}: CreateTaskSectionProps) {
	if (!isAuthenticated || !showCreateForm) return null;

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
