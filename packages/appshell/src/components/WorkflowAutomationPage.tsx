import type React from "react";
import { WorkflowList } from "../components/WorkflowList.tsx";

export const WorkflowAutomationPage: React.FC = () => {
	return (
		<div style={{ width: "100%", height: "100vh" }}>
			<WorkflowList />
		</div>
	);
};
