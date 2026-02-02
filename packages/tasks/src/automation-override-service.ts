import { v4 as uuidv4 } from "uuid";
import type {
    AutomationOverride,
    AutomationExecution,
    CreateOverrideInput,
    OverrideResult,
} from "./automation-override-types.ts";

interface ExecutionContext {
    abortController: AbortController;
    execution: AutomationExecution;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class AutomationOverrideService {
    private overrides: Map<string, AutomationOverride> = new Map();
    private activeExecutions: Map<string, ExecutionContext> = new Map();
    private executionHistory: AutomationExecution[] = [];
    private isGloballyPaused: boolean = false;
    private disabledRules: Set<string> = new Set();
    private listeners: Array<(override: AutomationOverride) => void> = [];

    constructor() {
        console.log("[AUTOMATION-OVERRIDE] Service initialized");
    }

    async createOverride(input: CreateOverrideInput): Promise<OverrideResult> {
        const overrideId = uuidv4();
        const now = new Date();
        const expiresAt = input.duration ? new Date(now.getTime() + input.duration * 1000) : undefined;

        const override: AutomationOverride = {
            id: overrideId,
            action: input.action,
            targetId: input.targetId,
            reason: input.reason,
            userId: input.userId,
            timestamp: now,
            expiresAt,
            status: "active",
        };

        this.overrides.set(overrideId, override);

        const result = await this.applyOverride(override);

        if (result.success) {
            this.notifyListeners(override);
            console.log(`[AUTOMATION-OVERRIDE] Created override ${overrideId}: ${input.action} by ${input.userId}`);
        }

        return result;
    }

    private async applyOverride(override: AutomationOverride): Promise<OverrideResult> {
        switch (override.action) {
            case "pause_all":
                return this.applyPauseAll(override);
            case "resume_all":
                return this.applyResumeAll(override);
            case "cancel_execution":
                return this.applyCancelExecution(override);
            case "disable_rule":
                return this.applyDisableRule(override);
            case "enable_rule":
                return this.applyEnableRule(override);
            case "emergency_stop":
                return this.applyEmergencyStop(override);
            default:
                return {
                    success: false,
                    error: `Unknown override action: ${override.action}`,
                    message: "Failed to apply override",
                };
        }
    }

    private applyPauseAll(override: AutomationOverride): OverrideResult {
        this.isGloballyPaused = true;
        console.log(`[AUTOMATION-OVERRIDE] All automation paused by ${override.userId}: ${override.reason}`);

        return {
            success: true,
            overrideId: override.id,
            message: "All automation has been paused. No new automation rules will be executed until resumed.",
        };
    }

    private applyResumeAll(override: AutomationOverride): OverrideResult {
        this.isGloballyPaused = false;
        console.log(`[AUTOMATION-OVERRIDE] All automation resumed by ${override.userId}: ${override.reason}`);

        return {
            success: true,
            overrideId: override.id,
            message: "All automation has been resumed. Automation rules will now execute normally.",
        };
    }

    private applyCancelExecution(override: AutomationOverride): OverrideResult {
        if (!override.targetId) {
            return {
                success: false,
                error: "targetId is required for cancel_execution action",
                message: "Failed to cancel execution",
            };
        }

        const context = this.activeExecutions.get(override.targetId);
        if (!context) {
            return {
                success: false,
                error: `Execution ${override.targetId} not found or already completed`,
                message: "Failed to cancel execution",
            };
        }

        context.abortController.abort();
        context.execution.status = "cancelled";
        context.execution.cancelledAt = new Date();
        context.execution.cancelledBy = override.userId;
        context.execution.cancelReason = override.reason;

        this.activeExecutions.delete(override.targetId);
        this.executionHistory.push(context.execution);

        console.log(`[AUTOMATION-OVERRIDE] Execution ${override.targetId} cancelled by ${override.userId}: ${override.reason}`);

        return {
            success: true,
            overrideId: override.id,
            message: `Execution ${override.targetId} has been cancelled`,
        };
    }

    private applyDisableRule(override: AutomationOverride): OverrideResult {
        if (!override.targetId) {
            return {
                success: false,
                error: "targetId is required for disable_rule action",
                message: "Failed to disable rule",
            };
        }

        this.disabledRules.add(override.targetId);
        console.log(`[AUTOMATION-OVERRIDE] Rule ${override.targetId} disabled by ${override.userId}: ${override.reason}`);

        return {
            success: true,
            overrideId: override.id,
            message: `Rule ${override.targetId} has been disabled`,
        };
    }

    private applyEnableRule(override: AutomationOverride): OverrideResult {
        if (!override.targetId) {
            return {
                success: false,
                error: "targetId is required for enable_rule action",
                message: "Failed to enable rule",
            };
        }

        this.disabledRules.delete(override.targetId);
        console.log(`[AUTOMATION-OVERRIDE] Rule ${override.targetId} enabled by ${override.userId}: ${override.reason}`);

        return {
            success: true,
            overrideId: override.id,
            message: `Rule ${override.targetId} has been enabled`,
        };
    }

    private applyEmergencyStop(override: AutomationOverride): OverrideResult {
        this.isGloballyPaused = true;

        const cancelledCount = this.activeExecutions.size;
        for (const [, context] of this.activeExecutions) {
            context.abortController.abort();
            context.execution.status = "cancelled";
            context.execution.cancelledAt = new Date();
            context.execution.cancelledBy = override.userId;
            context.execution.cancelReason = `Emergency stop: ${override.reason}`;
            this.executionHistory.push(context.execution);
        }

        this.activeExecutions.clear();

        console.log(`[AUTOMATION-OVERRIDE] EMERGENCY STOP by ${override.userId}: ${override.reason}. Cancelled ${cancelledCount} active executions.`);

        return {
            success: true,
            overrideId: override.id,
            message: `Emergency stop executed. All automation paused and ${cancelledCount} active executions cancelled.`,
        };
    }

    registerExecution(execution: AutomationExecution): AbortSignal {
        const abortController = new AbortController();
        this.activeExecutions.set(execution.id, {
            abortController,
            execution,
        });

        console.log(`[AUTOMATION-OVERRIDE] Registered execution ${execution.id} for rule ${execution.ruleName}`);

        return abortController.signal;
    }

    completeExecution(executionId: string, result: Record<string, unknown>): void {
        const context = this.activeExecutions.get(executionId);
        if (context) {
            context.execution.status = "completed";
            context.execution.completedAt = new Date();
            context.execution.result = result;
            this.executionHistory.push(context.execution);
            this.activeExecutions.delete(executionId);
            console.log(`[AUTOMATION-OVERRIDE] Execution ${executionId} completed`);
        }
    }

    failExecution(executionId: string, error: string): void {
        const context = this.activeExecutions.get(executionId);
        if (context) {
            context.execution.status = "failed";
            context.execution.completedAt = new Date();
            context.execution.error = error;
            this.executionHistory.push(context.execution);
            this.activeExecutions.delete(executionId);
            console.log(`[AUTOMATION-OVERRIDE] Execution ${executionId} failed: ${error}`);
        }
    }

    isAutomationPaused(): boolean {
        return this.isGloballyPaused;
    }

    isRuleDisabled(ruleId: string): boolean {
        return this.disabledRules.has(ruleId);
    }

    getActiveExecutions(): AutomationExecution[] {
        return Array.from(this.activeExecutions.values()).map((ctx) => ctx.execution);
    }

    getExecutionHistory(limit: number = 100): AutomationExecution[] {
        return this.executionHistory.slice(-limit);
    }

    getOverrides(): AutomationOverride[] {
        return Array.from(this.overrides.values());
    }

    getActiveOverrides(): AutomationOverride[] {
        const now = new Date();
        return Array.from(this.overrides.values()).filter((override) => {
            if (override.status !== "active") return false;
            if (override.expiresAt && override.expiresAt < now) {
                override.status = "expired";
                return false;
            }
            return true;
        });
    }

    revokeOverride(overrideId: string, userId: string): OverrideResult {
        const override = this.overrides.get(overrideId);
        if (!override) {
            return {
                success: false,
                error: `Override ${overrideId} not found`,
                message: "Failed to revoke override",
            };
        }

        if (override.status !== "active") {
            return {
                success: false,
                error: `Override ${overrideId} is already ${override.status}`,
                message: "Cannot revoke inactive override",
            };
        }

        override.status = "inactive";

        if (override.action === "pause_all" || override.action === "emergency_stop") {
            this.isGloballyPaused = false;
        }

        if (override.action === "disable_rule" && override.targetId) {
            this.disabledRules.delete(override.targetId);
        }

        console.log(`[AUTOMATION-OVERRIDE] Override ${overrideId} revoked by ${userId}`);

        return {
            success: true,
            message: `Override ${overrideId} has been revoked`,
        };
    }

    onOverride(callback: (override: AutomationOverride) => void): void {
        this.listeners.push(callback);
    }

    private notifyListeners(override: AutomationOverride): void {
        for (const listener of this.listeners) {
            listener(override);
        }
    }

    getStatus(): {
        isPaused: boolean;
        activeExecutions: number;
        disabledRules: number;
        activeOverrides: number;
    } {
        return {
            isPaused: this.isGloballyPaused,
            activeExecutions: this.activeExecutions.size,
            disabledRules: this.disabledRules.size,
            activeOverrides: this.getActiveOverrides().length,
        };
    }
}

let globalService: AutomationOverrideService | null = null;

export function getGlobalAutomationOverrideService(): AutomationOverrideService {
    if (!globalService) {
        globalService = new AutomationOverrideService();
    }
    return globalService;
}

export function resetGlobalAutomationOverrideService(): void {
    globalService = null;
}

