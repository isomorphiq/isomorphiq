import assert from "node:assert";
import { test } from "node:test";
import express from "express";
import { registerProfileRoutes } from "./profile-routes.ts";
import type { ProductManager } from "../../index.ts";
import type { ACPProfile, ProfileMetrics, ProfileState } from "../../acp-profiles.ts";
import type { Task } from "../../types.ts";

class StubProfileManager implements Pick<
	ProductManager,
	| "getProfilesWithStates"
	| "getAllProfileStates"
    | "getProfileState"
    | "getProfileMetrics"
    | "getAllProfileMetrics"
	| "getProfileTaskQueue"
	| "updateProfileStatus"
	| "assignTaskToProfile"
	| "getBestProfileForTask"
> {
	private profile: ACPProfile = {
		name: "alpha",
		role: "Test profile",
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

	getProfileTaskQueue(name: string) {
		return name === "alpha" ? [{ id: "t1" }] : [];
	}

	updateProfileStatus(name: string, isActive: boolean) {
		return name === "alpha" && isActive;
	}

	assignTaskToProfile(name: string, _task: Task) {
		void _task;
		return name === "alpha";
	}

	getBestProfileForTask(_task: Task) {
		void _task;
		return this.profile;
	}
}

const createServer = () => {
	const app = express();
	app.use(express.json());
    registerProfileRoutes(app, new StubProfileManager() as unknown as ProductManager);
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
    assert.deepStrictEqual(states[0], { name: "alpha", state: "ready" });

    const stateResponse = await fetch(`${base}/api/profiles/alpha/state`);
    assert.strictEqual(stateResponse.status, 200);
    const state = (await stateResponse.json()) as Record<string, unknown>;
    assert.strictEqual(state.name, "alpha");
});
