import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { WorkflowTask } from "../../agent-runner.ts";
import { QA_FAIL_TRANSITIONS, QA_RUN_TRANSITIONS } from "../transitions/qa-transitions.ts";
import { resolveWorkspaceRoot } from "./workspace-utils.ts";

const execFileAsync = promisify(execFileCallback);
const GIT_BUFFER_BYTES = 8 * 1024 * 1024;
const BRANCH_NAME_PATTERN = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/;

const TRANSITIONS_REQUIRING_TASK_BRANCH = new Set<string>([
    "begin-implementation",
    ...QA_RUN_TRANSITIONS,
    ...QA_FAIL_TRANSITIONS,
]);

type GitCommandResult = {
    ok: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    errorMessage: string | null;
};

const runGitCommand = async (
    workspaceRoot: string,
    args: string[],
): Promise<GitCommandResult> => {
    try {
        const result = await execFileAsync("git", args, {
            cwd: workspaceRoot,
            maxBuffer: GIT_BUFFER_BYTES,
        });
        return {
            ok: true,
            stdout: (result.stdout ?? "").toString(),
            stderr: (result.stderr ?? "").toString(),
            exitCode: 0,
            errorMessage: null,
        };
    } catch (error) {
        const gitError = error as {
            code?: number | string;
            stdout?: string;
            stderr?: string;
            message?: string;
        };
        return {
            ok: false,
            stdout: gitError.stdout ?? "",
            stderr: gitError.stderr ?? "",
            exitCode: typeof gitError.code === "number" ? gitError.code : null,
            errorMessage: gitError.message ?? String(error),
        };
    }
};

const requireGitCommand = async (
    workspaceRoot: string,
    args: string[],
    context: string,
): Promise<GitCommandResult> => {
    const result = await runGitCommand(workspaceRoot, args);
    if (result.ok) {
        return result;
    }
    const detail = [result.stderr, result.errorMessage]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .join("\n");
    throw new Error(`[WORKFLOW] ${context} failed.\n${detail}`);
};

const readTaskBranch = (task: WorkflowTask): string => {
    if (typeof task.branch !== "string") {
        return "";
    }
    return task.branch.trim();
};

const validateBranchName = (branchName: string): void => {
    if (branchName.length === 0) {
        throw new Error("[WORKFLOW] Task is missing a branch name.");
    }
    if (branchName.length > 120) {
        throw new Error(`[WORKFLOW] Invalid task branch "${branchName}": branch name is too long.`);
    }
    if (!BRANCH_NAME_PATTERN.test(branchName)) {
        throw new Error(
            `[WORKFLOW] Invalid task branch "${branchName}": branch must match ${BRANCH_NAME_PATTERN}.`,
        );
    }
};

const doesLocalBranchExist = async (
    workspaceRoot: string,
    branchName: string,
): Promise<boolean> => {
    const result = await runGitCommand(workspaceRoot, [
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${branchName}`,
    ]);
    return result.ok;
};

const checkoutBranch = async (workspaceRoot: string, branchName: string): Promise<void> => {
    await requireGitCommand(
        workspaceRoot,
        ["checkout", branchName],
        `Failed to checkout branch "${branchName}"`,
    );
};

const createAndCheckoutBranch = async (
    workspaceRoot: string,
    branchName: string,
): Promise<void> => {
    await requireGitCommand(
        workspaceRoot,
        ["checkout", "-b", branchName],
        `Failed to create branch "${branchName}"`,
    );
};

const transitionNeedsTaskBranch = (transition: string): boolean =>
    TRANSITIONS_REQUIRING_TASK_BRANCH.has(transition);

export const ensureTaskBranchCheckedOutForTransition = async (
    transition: string,
    task: WorkflowTask,
): Promise<string | null> => {
    if (!transitionNeedsTaskBranch(transition)) {
        return null;
    }

    const taskId =
        typeof task.id === "string" && task.id.trim().length > 0 ? task.id.trim() : "unknown-task";
    if (taskId === "unknown-task") {
        throw new Error(
            `[WORKFLOW] Transition "${transition}" requires a concrete task id to resolve branch checkout.`,
        );
    }
    const branchName = readTaskBranch(task);
    if (branchName.length === 0) {
        throw new Error(
            `[WORKFLOW] Transition "${transition}" requires a task branch. Task ${taskId} has no branch set.`,
        );
    }
    validateBranchName(branchName);

    const workspaceRoot = resolveWorkspaceRoot();
    const branchExists = await doesLocalBranchExist(workspaceRoot, branchName);

    if (transition === "begin-implementation") {
        if (branchExists) {
            await checkoutBranch(workspaceRoot, branchName);
            return branchName;
        }
        await createAndCheckoutBranch(workspaceRoot, branchName);
        return branchName;
    }

    if (!branchExists) {
        throw new Error(
            `[WORKFLOW] Missing implementation branch "${branchName}" for task ${taskId} during "${transition}". begin-implementation should have created it.`,
        );
    }

    await checkoutBranch(workspaceRoot, branchName);
    return branchName;
};

export const checkoutMainBranch = async (reason: string): Promise<void> => {
    const workspaceRoot = resolveWorkspaceRoot();
    const currentBranch = await requireGitCommand(
        workspaceRoot,
        ["rev-parse", "--abbrev-ref", "HEAD"],
        `Failed to resolve current branch before "${reason}"`,
    );
    if (currentBranch.stdout.trim() === "main") {
        return;
    }
    await requireGitCommand(
        workspaceRoot,
        ["checkout", "main"],
        `Failed to checkout main before "${reason}"`,
    );
};
