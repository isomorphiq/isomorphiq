// FILE_CONTEXT: "context-d04d2947-d4e4-4a3a-b3c5-cb9e4c07555b"

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
        <div id="dashboard-create-task" style={{ marginBottom: "16px" }}>
            <SectionCard title="Create New Task">
                <CreateTaskForm
                    onSuccess={() => {
                        onSuccess();
                        onToggle();
                    }}
                />
            </SectionCard>
        </div>
    );
}
