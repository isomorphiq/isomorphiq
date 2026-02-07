// FILE_CONTEXT: "context-536406e7-ae07-46aa-a306-7b6d2712c9cb"

import express from "express";
import type { ProfileManager } from "@isomorphiq/profiles";
import {
    normalizeProfileManagerResolver,
    type ProfileManagerResolver,
} from "./route-helpers.ts";

export function registerProfileRoutes(
    app: express.Application,
    managerOrResolver: ProfileManager | ProfileManagerResolver,
) {
    const resolveProfiles = normalizeProfileManagerResolver(managerOrResolver);
    const router = express.Router();

    router.get("/with-states", async (req, res, next) => {
        try {
            const manager = resolveProfiles(req);
            await manager.waitForProfileOverrides();
            const profiles = manager.getProfilesWithStates();
            res.json(profiles);
        } catch (error) {
            next(error);
        }
    });

    router.get("/configs", async (req, res, next) => {
        try {
            const manager = resolveProfiles(req);
            await manager.waitForProfileOverrides();
            const profiles = manager.getAllProfileConfigurations();
            res.json(profiles);
        } catch (error) {
            next(error);
        }
    });

    router.get("/states", async (req, res, next) => {
        try {
            const manager = resolveProfiles(req);
            const states = manager.getAllProfileStates();
            res.json(states);
        } catch (error) {
            next(error);
        }
    });

    router.get("/:name/state", async (req, res, next) => {
        try {
            const manager = resolveProfiles(req);
            const state = manager.getProfileState(req.params.name);
            if (!state) {
                return res.status(404).json({ error: "Profile not found" });
            }
            res.json(state);
        } catch (error) {
            next(error);
        }
    });

    router.get("/:name/metrics", async (req, res, next) => {
        try {
            const manager = resolveProfiles(req);
            const metrics = manager.getProfileMetrics(req.params.name);
            if (!metrics) {
                return res.status(404).json({ error: "Profile not found" });
            }
            res.json(metrics);
        } catch (error) {
            next(error);
        }
    });

    router.get("/:name/config", async (req, res, next) => {
        try {
            const manager = resolveProfiles(req);
            await manager.waitForProfileOverrides();
            const profileConfig = manager.getProfileConfiguration(req.params.name);
            if (!profileConfig) {
                return res.status(404).json({ error: "Profile not found" });
            }
            res.json(profileConfig);
        } catch (error) {
            next(error);
        }
    });

    router.get("/metrics", async (req, res, next) => {
        try {
            const manager = resolveProfiles(req);
            const metrics = Object.fromEntries(manager.getAllProfileMetrics());
            res.json(metrics);
        } catch (error) {
            next(error);
        }
    });

    router.get("/:name/queue", async (req, res, next) => {
        try {
            const manager = resolveProfiles(req);
            const queue = manager.getTaskQueue(req.params.name);
            res.json(queue);
        } catch (error) {
            next(error);
        }
    });

    router.put("/:name/status", async (req, res, next) => {
        try {
            const { isActive } = req.body;
            if (typeof isActive !== "boolean") {
                return res.status(400).json({ error: "isActive must be a boolean" });
            }

            const manager = resolveProfiles(req);
            const state = manager.getProfileState(req.params.name);
            if (!state) {
                return res.status(404).json({ error: "Profile not found" });
            }
            manager.updateProfileState(req.params.name, { isActive });

            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    router.put("/:name/config", async (req, res, next) => {
        try {
            const { runtimeName, modelName, systemPrompt, taskPromptPrefix } = req.body as {
                runtimeName?: unknown;
                modelName?: unknown;
                systemPrompt?: unknown;
                taskPromptPrefix?: unknown;
            };
            const isValidText = (value: unknown): boolean =>
                value === undefined || value === null || typeof value === "string";
            if (
                !isValidText(runtimeName)
                || !isValidText(modelName)
                || !isValidText(systemPrompt)
                || !isValidText(taskPromptPrefix)
            ) {
                return res.status(400).json({
                    error: "runtimeName, modelName, systemPrompt, and taskPromptPrefix must be string, null, or undefined",
                });
            }
            if (
                runtimeName !== undefined
                && runtimeName !== null
                && runtimeName !== "codex"
                && runtimeName !== "opencode"
            ) {
                return res.status(400).json({
                    error: "runtimeName must be either \"codex\" or \"opencode\"",
                });
            }

            const manager = resolveProfiles(req);
            await manager.waitForProfileOverrides();
            const updated = await manager.updateProfileConfiguration(req.params.name, {
                ...(runtimeName !== undefined
                    ? { runtimeName: runtimeName === null ? undefined : String(runtimeName) }
                    : {}),
                ...(modelName !== undefined
                    ? { modelName: modelName === null ? undefined : String(modelName) }
                    : {}),
                ...(systemPrompt !== undefined
                    ? { systemPrompt: systemPrompt === null ? undefined : String(systemPrompt) }
                    : {}),
                ...(taskPromptPrefix !== undefined
                    ? { taskPromptPrefix: taskPromptPrefix === null ? undefined : String(taskPromptPrefix) }
                    : {}),
            });
            if (!updated) {
                return res.status(404).json({ error: "Profile not found" });
            }
            res.json(updated);
        } catch (error) {
            next(error);
        }
    });

    router.post("/:name/assign-task", async (req, res, next) => {
        try {
            const { task } = req.body;
            if (!task || !task.title || !task.description) {
                return res.status(400).json({ error: "Task must have title and description" });
            }

            const manager = resolveProfiles(req);
            const profile = manager.getProfile(req.params.name);
            if (!profile) {
                return res.status(404).json({ error: "Profile not found" });
            }
            manager.addToTaskQueue(req.params.name, task);

            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    router.post("/best-for-task", async (req, res, next) => {
        try {
            const { task } = req.body;
            if (!task || !task.title) {
                return res.status(400).json({ error: "Task must have title" });
            }

            const manager = resolveProfiles(req);
            const bestProfile = manager.getBestProfileForTask(task);
            res.json({ bestProfile });
        } catch (error) {
            next(error);
        }
    });

    app.use("/api/profiles", router);
}
