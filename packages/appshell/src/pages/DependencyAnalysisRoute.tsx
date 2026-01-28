import { useAtom } from "jotai";
import { tasksAtom } from "../atoms.ts";
import { DependencyAnalysisPage } from "../components/DependencyAnalysisPage.tsx";

export function DependencyAnalysisRoute() {
	const [allTasks] = useAtom(tasksAtom);
	return <DependencyAnalysisPage tasks={allTasks} />;
}
