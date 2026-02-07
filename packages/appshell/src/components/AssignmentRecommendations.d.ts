import type React from "react";
interface AssignmentRecommendationsProps {
    taskId: string;
    onAssign?: (userId: string) => void;
    onClose?: () => void;
}
export declare const AssignmentRecommendations: React.FC<AssignmentRecommendationsProps>;
export {};
