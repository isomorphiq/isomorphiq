import assert from "node:assert";
import { test } from "node:test";
import express from "express";
import "../../../../../tests/test-utils/env-fetch.ts";
import { registerProfileRoutes } from "./profile-routes.ts";
import type { ACPProfile, ProfileMetrics, ProfileState, ProfileManager } from "@isomorphiq/user-profile";
import type { Task } from "@isomorphiq/tasks";

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class StubProfileManager implements Pick<
	ProfileManager,
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
> {
	private profile: ACPProfile = {
		name: "alpha",
		role: "Test profile",
		principalType: "agent",
		systemPrompt: "Test",
		getTaskPrompt: () => "test",
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
}

const createServer = () => {
	const app = express();
	app.use(express.json());
    registerProfileRoutes(app, new StubProfileManager() as unknown as ProfileManager);
    return app.listen(0);
};

test("profile routes: with-states and state", async (t) => {
    const server = createServer();
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

