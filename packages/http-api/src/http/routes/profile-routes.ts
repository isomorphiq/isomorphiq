import express from "express";
import type { ProfileManager } from "@isomorphiq/user-profile";
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
            const profiles = manager.getProfilesWithStates();
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
