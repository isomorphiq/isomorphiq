import { createContextClient, type ContextClient } from "@isomorphiq/context";
import type { TaskActionLog, TaskStatus } from "@isomorphiq/types";
import { randomUUID } from "node:crypto";
import type { WorkflowTask, WorkflowTaskExecutor } from "../agent-runner.ts";
import type { RuntimeState } from "../workflow-factory.ts";
import { createToken, type WorkflowToken } from "../workflow-engine.ts";
import { WORKFLOW } from "../workflow.ts";
import { executeTransition } from "./loop/execute-transition.ts";
import { prepareTransition } from "./loop/prepare-transition.ts";
import { resolveTaskForTransition } from "./loop/resolve-task.ts";
import {
    createNoTaskWaitLogState,
    ensureContextId,
    loadContextData,
    type NoTaskWaitLogState,
    updateContextData,
} from "./runner-context.ts";
import { sleep } from "./shared/basic-utils.ts";
import { checkoutMainBranch } from "./shared/git-branch.ts";
import {
    deriveStateFromTasks,
    hasRunnableImplementationTasks,
} from "./shared/task-selection.ts";
import { buildTaskContextSnapshot } from "./shared/task-context.ts";
import type {
    ProfileWorkflowRunnerOptions,
    WorkflowContextToken,
    WorkflowTaskUpdateInput,
} from "./types.ts";

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class ProfileWorkflowRunner {
    private static readonly NO_TASK_WAIT_HEARTBEAT_MS = 60_000;
    private taskProvider: () => Promise<WorkflowTask[]>;
    private taskExecutor: WorkflowTaskExecutor;
    private token: WorkflowToken<WorkflowContextToken>;
    private environment: string | undefined;
    private pollIntervalMs: number;
    private contextClient: ContextClient;
    private updateTaskStatus?: (id: string, status: TaskStatus, updatedBy?: string) => Promise<void>;
    private updateTask?: (
        id: string,
        updates: WorkflowTaskUpdateInput,
        updatedBy?: string,
    ) => Promise<WorkflowTask>;
    private appendTaskActionLogEntry?: (
        taskId: string,
        entry: TaskActionLog,
        fallbackLog?: TaskActionLog[],
    ) => Promise<void>;
    private workerId: string;
    private claimTask?: (taskId: string) => Promise<WorkflowTask | null>;
    private noTaskWaitState: NoTaskWaitLogState = createNoTaskWaitLogState();
    constructor(options: ProfileWorkflowRunnerOptions) {
        this.taskProvider = options.taskProvider;
        this.taskExecutor = options.taskExecutor;
        this.environment = options.environment;
        this.pollIntervalMs = options.pollIntervalMs ?? 10000;
        this.contextClient = createContextClient({ environment: options.environment });
        this.updateTaskStatus = options.updateTaskStatus;
        this.updateTask = options.updateTask;
        this.appendTaskActionLogEntry = options.appendTaskActionLogEntry;
        this.workerId = options.workerId ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
        this.claimTask = options.claimTask;
        this.token = createToken<WorkflowContextToken>(
            options.initialState ?? "themes-proposed",
            options.contextId ? { contextId: options.contextId } : undefined,
        );
    }
    private resolveState(): RuntimeState | null {
        const state = WORKFLOW[this.token.state];
        if (!state) {
            console.warn(`[WORKFLOW] Unknown workflow state: ${this.token.state}`);
            return null;
        }
        return state;
    }
    private async resolveBaseContext(tasks: WorkflowTask[]): Promise<{
        contextId: string;
        context: Record<string, unknown>;
    }> {
        const ensured = await ensureContextId(this.token, this.contextClient);
        this.token = ensured.token;
        const baseContext = await loadContextData(this.contextClient, ensured.contextId);
        const claimModeEnabled = typeof this.claimTask === "function";
        const shouldRecover =
            !claimModeEnabled
            && (this.token.state === "themes-proposed" || this.token.state === "new-feature-proposed")
            && baseContext.autoRecovered !== true;
        const derived = shouldRecover ? deriveStateFromTasks(tasks) : null;
        const recoveredTaskSnapshot = derived?.currentTaskId
            ? buildTaskContextSnapshot(
                tasks.find((task) => task.id === derived.currentTaskId) ?? { id: derived.currentTaskId },
                derived.currentTaskId,
            )
            : null;
        const recoveryPatch =
            derived && derived.state !== this.token.state
                ? {
                    autoRecovered: true,
                    ...(derived.currentTaskId ? { currentTaskId: derived.currentTaskId } : {}),
                    ...(recoveredTaskSnapshot
                        ? {
                            currentTask: recoveredTaskSnapshot,
                            currentTaskBranch:
                                typeof recoveredTaskSnapshot.branch === "string"
                                    ? recoveredTaskSnapshot.branch
                                    : null,
                        }
                        : {
                            currentTask: null,
                            currentTaskBranch: null,
                        }),
                }
                : null;
        const context = recoveryPatch ? { ...baseContext, ...recoveryPatch } : baseContext;
        if (recoveryPatch) {
            await updateContextData(this.contextClient, ensured.contextId, recoveryPatch);
            this.token = {
                ...this.token,
                state: derived?.state ?? this.token.state,
                context: { contextId: ensured.contextId },
            };
            console.log(
                `[WORKFLOW] Auto-recovered state=${derived?.state ?? this.token.state} currentTaskId=${derived?.currentTaskId ?? "none"}`,
            );
        }
        return { contextId: ensured.contextId, context };
    }

    async runLoop(): Promise<void> {
        console.log("[WORKFLOW] Starting profile-driven workflow loop");
        await checkoutMainBranch("supervisor-start");
        while (true) {
            try {
                const tasks = await this.taskProvider();
                const { contextId, context: tokenContext } = await this.resolveBaseContext(tasks);
                const state = this.resolveState();
                if (!state) {
                    await sleep(this.pollIntervalMs);
                    continue;
                }

                const preparedTransition = await prepareTransition({
                    state,
                    tasks,
                    tokenState: this.token.state,
                    tokenContext,
                    contextId,
                    environment: this.environment,
                    taskExecutor: this.taskExecutor,
                });
                if (!preparedTransition) {
                    await sleep(this.pollIntervalMs);
                    continue;
                }

                if (preparedTransition.transition === "pick-up-next-task") {
                    if (!hasRunnableImplementationTasks(tasks)) {
                        console.warn(
                            "[WORKFLOW] Skipping pick-up-next-task: no runnable implementation task is available",
                        );
                        await sleep(this.pollIntervalMs);
                        continue;
                    }
                    await updateContextData(this.contextClient, contextId, {
                        currentTaskId: null,
                        currentTask: null,
                        currentTaskBranch: null,
                        lastTestResult: null,
                        testStatus: null,
                        testReport: null,
                        e2eTestResultStatus: null,
                        "e2e-test-result-status": null,
                        e2eTestResults: null,
                        "e2e-test-results": null,
                        e2eTestFailureInvestigationReport: null,
                        "e2e-test-failure-investigation-report": null,
                        mechanicalQaPreflightResults: null,
                        mechanicalTestLintResults: null,
                        mechanicalQaPreflightStage: null,
                        mechanicalQaPreflightUpdatedAt: null,
                        mechanicalTestLintResultsUpdatedAt: null,
                    });
                    this.token = {
                        ...this.token,
                        state: preparedTransition.nextStateName,
                        context: { contextId },
                    };
                    continue;
                }

                const taskResolution = await resolveTaskForTransition({
                    tokenState: this.token.state,
                    state,
                    tasks,
                    transition: preparedTransition,
                    claimModeEnabled: typeof this.claimTask === "function",
                    claimTask: this.claimTask,
                    workerId: this.workerId,
                    noTaskWaitState: this.noTaskWaitState,
                    noTaskWaitHeartbeatMs: ProfileWorkflowRunner.NO_TASK_WAIT_HEARTBEAT_MS,
                });
                this.noTaskWaitState = taskResolution.noTaskWaitState;
                if (taskResolution.kind === "wait") {
                    await sleep(this.pollIntervalMs);
                    continue;
                }

                console.log(
                    `[WORKFLOW] state=${state.name} transition=${taskResolution.transition.transition} tasks=${tasks.length}`,
                );
                await executeTransition({
                    contextClient: this.contextClient,
                    contextId,
                    tokenState: this.token.state,
                    tokenContext,
                    transition: taskResolution.transition,
                    task: taskResolution.task,
                    taskCandidate: taskResolution.taskCandidate,
                    tasks,
                    taskExecutor: this.taskExecutor,
                    environment: this.environment,
                    updateTaskStatus: this.updateTaskStatus,
                    updateTask: this.updateTask,
                    appendTaskActionLogEntry: this.appendTaskActionLogEntry,
                });

                this.token = {
                    ...this.token,
                    state: taskResolution.transition.nextStateName,
                    context: { contextId },
                };
            } catch (error) {
                console.error("[WORKFLOW] Error in profile workflow loop:", error);
            }

            await sleep(this.pollIntervalMs);
        }
    }
}
