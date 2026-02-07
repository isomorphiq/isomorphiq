import assert from "node:assert";
import { test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import "../../../../../tests/test-utils/env-fetch.ts";
import { registerProfileRoutes } from "./profile-routes.ts";
import type {
    ACPProfile,
    ProfileConfigurationSnapshot,
    ProfileManager,
    ProfileMetrics,
    ProfileState,
} from "@isomorphiq/profiles";
import type { Task } from "@isomorphiq/tasks";

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class StubProfileManager implements Pick<
    ProfileManager,
    | "waitForProfileOverrides"
    | "getProfilesWithStates"
    | "getAllProfileStates"
    | "getProfileState"
    | "getProfileMetrics"
    | "getAllProfileMetrics"
    | "getTaskQueue"
    | "updateProfileState"
    | "addToTaskQueue"
    | "getBestProfileForTask"
    | "getProfile"
    | "getProfileConfiguration"
    | "getAllProfileConfigurations"
    | "updateProfileConfiguration"
> {
    private profile: ACPProfile = {
        name: "alpha",
        role: "Test profile",
        principalType: "agent",
        systemPrompt: "Test",
        getTaskPrompt: () => "test",
        runtimeName: "codex",
        modelName: "gpt-5.2-codex",
    };

    private state: ProfileState = {
        name: "alpha",
        isActive: true,
        currentTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        averageProcessingTime: 0,
        lastActivity: new Date(),
        queueSize: 0,
        isProcessing: false,
    };

    private metrics: ProfileMetrics = {
        throughput: 10,
        successRate: 1,
        averageTaskDuration: 10,
        queueWaitTime: 0,
        errorRate: 0,
    };

    private config = {
        defaults: {
            runtimeName: "codex",
            modelName: "gpt-5.2-codex",
            systemPrompt: "Test",
        },
        overrides: {
            runtimeName: undefined,
            modelName: undefined,
            systemPrompt: undefined,
            taskPromptPrefix: undefined,
        },
    };

    async waitForProfileOverrides() {
        return Promise.resolve();
    }

    private buildConfigSnapshot(): ProfileConfigurationSnapshot {
        return {
            name: "alpha",
            defaults: this.config.defaults,
            overrides: this.config.overrides,
            effective: {
                runtimeName: this.config.overrides.runtimeName ?? this.config.defaults.runtimeName,
                modelName: this.config.overrides.modelName ?? this.config.defaults.modelName,
                systemPrompt: this.config.overrides.systemPrompt ?? this.config.defaults.systemPrompt,
                taskPromptPrefix: this.config.overrides.taskPromptPrefix,
            },
            updatedAt: "2026-01-01T00:00:00.000Z",
        };
    }

    getProfilesWithStates() {
        return [{ profile: this.profile, state: this.state, metrics: this.metrics }];
    }

    getAllProfileStates() {
        return [this.state];
    }

    getProfileState(name: string) {
        return name === "alpha" ? this.state : undefined;
    }

    getProfileMetrics(name: string) {
        return name === "alpha" ? this.metrics : undefined;
    }

    getAllProfileMetrics() {
        return new Map([["alpha", this.metrics]]);
    }

    getTaskQueue(name: string) {
        void name;
        return [] as Task[];
    }

    updateProfileState(name: string, _updates: Partial<ProfileState>) {
        return name === "alpha";
    }

    addToTaskQueue(name: string, _task: Task) {
        void _task;
        return name === "alpha";
    }

    getBestProfileForTask(_task: Task) {
        void _task;
        return this.profile;
    }

    getProfile(name: string) {
        return name === "alpha" ? this.profile : undefined;
    }

    getProfileConfiguration(name: string) {
        return name === "alpha" ? this.buildConfigSnapshot() : null;
    }

    getAllProfileConfigurations() {
        return [this.buildConfigSnapshot()];
    }

    async updateProfileConfiguration(
        name: string,
        patch: Partial<{
            runtimeName?: string;
            modelName?: string;
            systemPrompt?: string;
            taskPromptPrefix?: string;
        }>,
    ) {
        if (name !== "alpha") {
            return null;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "runtimeName")) {
            this.config.overrides.runtimeName = patch.runtimeName;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "modelName")) {
            this.config.overrides.modelName = patch.modelName;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "systemPrompt")) {
            this.config.overrides.systemPrompt = patch.systemPrompt;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "taskPromptPrefix")) {
            this.config.overrides.taskPromptPrefix = patch.taskPromptPrefix;
        }
        return this.buildConfigSnapshot();
    }
}

const createServer = async (): Promise<Server> => {
    const app = express();
    app.use(express.json());
    registerProfileRoutes(app, new StubProfileManager() as unknown as ProfileManager);
    return new Promise((resolve, reject) => {
        const server = app.listen(0, "127.0.0.1");
        server.once("listening", () => resolve(server));
        server.once("error", (error) => reject(error));
    });
};

test("profile routes: with-states and state", async (t) => {
    const server = await createServer();
    t.after(() => server.close());
    const { port } = server.address() as { port: number };
    const base = `http://127.0.0.1:${port}`;

    const statesResponse = await fetch(`${base}/api/profiles/with-states`);
    assert.strictEqual(statesResponse.status, 200);
    const states = (await statesResponse.json()) as unknown[];
    assert.ok(Array.isArray(states));
    const first = states[0] as Record<string, unknown>;
    assert.strictEqual((first.profile as { name?: string }).name, "alpha");
    assert.strictEqual((first.state as { name?: string }).name, "alpha");

    const stateResponse = await fetch(`${base}/api/profiles/alpha/state`);
    assert.strictEqual(stateResponse.status, 200);
    const state = (await stateResponse.json()) as Record<string, unknown>;
    assert.strictEqual(state.name, "alpha");
});

test("profile routes: get and update profile config", async (t) => {
    const server = await createServer();
    t.after(() => server.close());
    const { port } = server.address() as { port: number };
    const base = `http://127.0.0.1:${port}`;

    const listResponse = await fetch(`${base}/api/profiles/configs`);
    assert.strictEqual(listResponse.status, 200);
    const listData = (await listResponse.json()) as Array<Record<string, unknown>>;
    assert.strictEqual(listData.length, 1);
    assert.strictEqual(listData[0].name, "alpha");

    const initialResponse = await fetch(`${base}/api/profiles/alpha/config`);
    assert.strictEqual(initialResponse.status, 200);
    const initial = (await initialResponse.json()) as {
        defaults: { runtimeName?: string };
        overrides: { runtimeName?: string };
    };
    assert.strictEqual(initial.defaults.runtimeName, "codex");
    assert.strictEqual(initial.overrides.runtimeName, undefined);

    const updateResponse = await fetch(`${base}/api/profiles/alpha/config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            runtimeName: "opencode",
            modelName: "qwen3",
            systemPrompt: "Custom system prompt",
            taskPromptPrefix: "Always use MCP tools first.",
        }),
    });
    assert.strictEqual(updateResponse.status, 200);
    const updated = (await updateResponse.json()) as {
        overrides: { runtimeName?: string; modelName?: string; taskPromptPrefix?: string };
        effective: { runtimeName?: string; modelName?: string; taskPromptPrefix?: string };
    };
    assert.strictEqual(updated.overrides.runtimeName, "opencode");
    assert.strictEqual(updated.effective.runtimeName, "opencode");
    assert.strictEqual(updated.overrides.modelName, "qwen3");
    assert.strictEqual(updated.effective.taskPromptPrefix, "Always use MCP tools first.");

    const clearResponse = await fetch(`${base}/api/profiles/alpha/config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            runtimeName: null,
            modelName: null,
            systemPrompt: null,
            taskPromptPrefix: null,
        }),
    });
    assert.strictEqual(clearResponse.status, 200);
    const cleared = (await clearResponse.json()) as {
        overrides: { runtimeName?: string; modelName?: string; systemPrompt?: string; taskPromptPrefix?: string };
        effective: { runtimeName?: string };
    };
    assert.strictEqual(cleared.overrides.runtimeName, undefined);
    assert.strictEqual(cleared.overrides.modelName, undefined);
    assert.strictEqual(cleared.overrides.systemPrompt, undefined);
    assert.strictEqual(cleared.overrides.taskPromptPrefix, undefined);
    assert.strictEqual(cleared.effective.runtimeName, "codex");
});

test("profile routes: validates runtime and status route", async (t) => {
    const server = await createServer();
    t.after(() => server.close());
    const { port } = server.address() as { port: number };
    const base = `http://127.0.0.1:${port}`;

    const invalidRuntimeResponse = await fetch(`${base}/api/profiles/alpha/config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runtimeName: "invalid-runtime" }),
    });
    assert.strictEqual(invalidRuntimeResponse.status, 400);

    const statusResponse = await fetch(`${base}/api/profiles/alpha/status`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: false }),
    });
    assert.strictEqual(statusResponse.status, 200);
});
