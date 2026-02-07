import type React from "react";
import type { WorkflowDefinition } from "@isomorphiq/workflow/types";
interface WorkflowEditorProps {
    workflow?: WorkflowDefinition;
    onSave?: (workflow: WorkflowDefinition) => void;
    onCancel?: () => void;
    readonly?: boolean;
}
export declare const WorkflowEditor: React.FC<WorkflowEditorProps>;
export {};
