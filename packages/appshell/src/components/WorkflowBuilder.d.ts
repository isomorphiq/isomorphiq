import type React from "react";
import type { WorkflowDefinition, WorkflowNodeParameter, WorkflowNodePort, WorkflowNodeType } from "@isomorphiq/workflow/types";
export interface WorkflowNodeTypeConfig {
    type: WorkflowNodeType;
    label: string;
    description?: string;
    icon: string;
    color: string;
    inputs?: WorkflowNodePort[];
    outputs?: WorkflowNodePort[];
    parameters?: WorkflowNodeParameter[];
}
interface WorkflowBuilderProps {
    workflow: WorkflowDefinition;
    onWorkflowChange: (workflow: WorkflowDefinition) => void;
    nodeTypes: WorkflowNodeTypeConfig[];
    readonly?: boolean;
}
export declare const WorkflowBuilder: React.FC<WorkflowBuilderProps>;
export {};
