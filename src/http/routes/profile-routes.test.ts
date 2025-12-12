import assert from "node:assert";
import { test } from "node:test";
import express from "express";
import { registerProfileRoutes } from "./profile-routes.ts";
import type { ProductManager } from "../../index.ts";

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
    getProfilesWithStates() {
        return [{ name: "alpha", state: "ready" }];
    }

    getAllProfileStates() {
        return { alpha: "ready" };
    }

    getProfileState(name: string) {
        return name === "alpha" ? { name, state: "ready" } : null;
    }

    getProfileMetrics(name: string) {
        return name === "alpha" ? { throughput: 10 } : null;
    }

    getAllProfileMetrics() {
        return new Map([["alpha", { throughput: 10 }]]);
    }

    getProfileTaskQueue(name: string) {
        return name === "alpha" ? [{ id: "t1" }] : [];
    }

    updateProfileStatus(name: string, isActive: boolean) {
        return name === "alpha" && isActive;
    }

    assignTaskToProfile(name: string, _task: unknown) {
        return name === "alpha";
    }

    getBestProfileForTask(_task: unknown) {
        return { name: "alpha" };
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
