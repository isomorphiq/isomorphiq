import type express from "express";
import { ConfigManager } from "@isomorphiq/core";

export function registerEnvironmentRoutes(app: express.Application) {
    app.get("/api/environments", (_req, res) => {
        const config = ConfigManager.getInstance().getEnvironmentConfig();
        res.json({
            available: config.available,
            default: config.default,
            headerName: config.headerName,
        });
    });
}
