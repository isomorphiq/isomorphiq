import express from "express";
import type { ProductManager } from "@isomorphiq/tasks";

export function registerProfileRoutes(app: express.Application, pm: ProductManager) {
    const router = express.Router();

    router.get("/with-states", async (_req, res, next) => {
        try {
            const profiles = pm.getProfilesWithStates();
            res.json(profiles);
        } catch (error) {
            next(error);
        }
    });

    router.get("/states", async (_req, res, next) => {
        try {
            const states = pm.getAllProfileStates();
            res.json(states);
        } catch (error) {
            next(error);
        }
    });

    router.get("/:name/state", async (req, res, next) => {
        try {
            const state = pm.getProfileState(req.params.name);
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
            const metrics = pm.getProfileMetrics(req.params.name);
            if (!metrics) {
                return res.status(404).json({ error: "Profile not found" });
            }
            res.json(metrics);
        } catch (error) {
            next(error);
        }
    });

    router.get("/metrics", async (_req, res, next) => {
        try {
            const metrics = Object.fromEntries(pm.getAllProfileMetrics());
            res.json(metrics);
        } catch (error) {
            next(error);
        }
    });

    router.get("/:name/queue", async (req, res, next) => {
        try {
            const queue = pm.getProfileTaskQueue(req.params.name);
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

            const success = pm.updateProfileStatus(req.params.name, isActive);
            if (!success) {
                return res.status(404).json({ error: "Profile not found" });
            }

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

            const success = pm.assignTaskToProfile(req.params.name, task);
            if (!success) {
                return res.status(404).json({ error: "Profile not found" });
            }

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

            const bestProfile = pm.getBestProfileForTask(task);
            res.json({ bestProfile });
        } catch (error) {
            next(error);
        }
    });

    app.use("/api/profiles", router);
}
