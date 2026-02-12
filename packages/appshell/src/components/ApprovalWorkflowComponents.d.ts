import type { ApprovalWorkflow, CreateApprovalWorkflowInput } from "@isomorphiq/workflow/approval-types";
type ApprovalWorkflowListProps = {
    onSelectWorkflow?: (workflow: ApprovalWorkflow) => void;
    onCreateWorkflow?: () => void;
};
export declare function ApprovalWorkflowList({ onSelectWorkflow, onCreateWorkflow, }: ApprovalWorkflowListProps): import("react/jsx-runtime").JSX.Element;
type ApprovalWorkflowFormProps = {
    workflow?: ApprovalWorkflow;
    onSave: (workflow: CreateApprovalWorkflowInput) => void;
    onCancel: () => void;
};
export declare function ApprovalWorkflowForm({ workflow, onSave, onCancel }: ApprovalWorkflowFormProps): import("react/jsx-runtime").JSX.Element;
export {};
