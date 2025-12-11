import { exec } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(exec);

export async function gitCommitIfChanges(message = "chore: tests passing"): Promise<string> {
	try {
		const status = await pexec("git status --porcelain");
		if (!status.stdout.trim()) {
			return "No changes to commit";
		}

		await pexec("git add -A");
		const commit = await pexec(`git commit -m "${message.replace(/"/g, '\\"')}"`);
		return commit.stdout || commit.stderr || "Committed";
	} catch (error: unknown) {
		const err = error as { stdout?: string; stderr?: string; message?: string };
		const out = err?.stdout ?? "";
		const errMsg = err?.stderr ?? err?.message ?? String(error);
		throw new Error(`Git commit failed: ${out}\n${errMsg}`);
	}
}
