import { exec } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(exec);

export interface TestRunResult {
	passed: boolean;
	lintPassed: boolean;
	testPassed: boolean;
	output: string;
}

export async function runLintAndTests(): Promise<TestRunResult> {
	let output = "";
	let lintPassed = false;
	let testPassed = false;

	try {
		const lint = await pexec("npm run lint", { timeout: 120_000 });
		output += `--- LINT STDOUT ---\n${lint.stdout}\n--- LINT STDERR ---\n${lint.stderr}\n`;
		lintPassed = lint.exitCode === 0;
	} catch (error) {
		const err = error as { stdout?: string; stderr?: string; message?: string };
		output += `--- LINT ERROR ---\n${err.stdout ?? ""}\n${err.stderr ?? err.message ?? String(err)}\n`;
		return { passed: false, lintPassed, testPassed, output };
	}

	try {
		const test = await pexec("npm test", { timeout: 180_000 });
		output += `--- TEST STDOUT ---\n${test.stdout}\n--- TEST STDERR ---\n${test.stderr}\n`;
		testPassed = test.exitCode === 0;
	} catch (error) {
		const err = error as { stdout?: string; stderr?: string; message?: string };
		output += `--- TEST ERROR ---\n${err.stdout ?? ""}\n${err.stderr ?? err.message ?? String(err)}\n`;
		return { passed: false, lintPassed, testPassed, output };
	}

	return { passed: lintPassed && testPassed, lintPassed, testPassed, output };
}
