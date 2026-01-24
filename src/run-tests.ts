import { exec } from "node:child_process";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const getErrorField = (error: unknown, field: string): string | undefined => {
	if (!isRecord(error)) {
		return undefined;
	}
	const value = error[field];
	return typeof value === "string" ? value : undefined;
};

function execWithCode(
	command: string,
	options?: { timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((resolve, reject) => {
		exec(command, options, (error, stdout, stderr) => {
			if (error) {
				reject(error);
			} else {
				resolve({
					stdout: (stdout || "").toString(),
					stderr: (stderr || "").toString(),
					exitCode: 0,
				});
			}
		});
	});
}

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
		const lint = await execWithCode("yarn run lint", { timeout: 120_000 });
		output += `--- LINT STDOUT ---\n${lint.stdout}\n--- LINT STDERR ---\n${lint.stderr}\n`;
		lintPassed = lint.exitCode === 0;
	} catch (error) {
		const stdout = getErrorField(error, "stdout") ?? "";
		const stderr = getErrorField(error, "stderr");
		const message = getErrorField(error, "message") ?? String(error);
		output += `--- LINT ERROR ---\n${stdout}\n${stderr ?? message}\n`;
		return { passed: false, lintPassed, testPassed, output };
	}

	try {
		const test = await execWithCode("yarn run test", { timeout: 180_000 });
		output += `--- TEST STDOUT ---\n${test.stdout}\n--- TEST STDERR ---\n${test.stderr}\n`;
		testPassed = test.exitCode === 0;
	} catch (error) {
		const stdout = getErrorField(error, "stdout") ?? "";
		const stderr = getErrorField(error, "stderr");
		const message = getErrorField(error, "message") ?? String(error);
		output += `--- TEST ERROR ---\n${stdout}\n${stderr ?? message}\n`;
		return { passed: false, lintPassed, testPassed, output };
	}

	return { passed: lintPassed && testPassed, lintPassed, testPassed, output };
}
