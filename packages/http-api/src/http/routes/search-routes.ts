import type express from "express";
import type {
    CreateSavedSearchInput,
    SearchQuery,
    UpdateSavedSearchInput,
} from "@isomorphiq/tasks";
import type { User } from "@isomorphiq/auth";
import { ProductManager } from "@isomorphiq/tasks";
import { getUserManager } from "@isomorphiq/auth";
import {
    authenticateToken,
    requirePermission,
    type AuthContextRequest,
} from "@isomorphiq/auth";

export function registerSearchRoutes(app: express.Application, pm: ProductManager) {
    // POST /api/search/advanced - Advanced task search with filtering
    app.post("/api/search/advanced", authenticateToken, async (req: AuthContextRequest, res, next) => {
        try {
            const user = req.user as User;
            if (!user) {
                return res.status(401).json({ error: "Authentication required" });
            }
            console.log(
                `[HTTP API] POST /api/search/advanced - Advanced search by user: ${user.username}`,
            );

            const searchQuery = req.body as SearchQuery;

            const userManager = getUserManager();
            const hasAdminPermission = await userManager.hasPermission(user, "tasks", "read");

            if (!hasAdminPermission) {
                searchQuery.createdBy = [user.id];
                searchQuery.assignedTo = [user.id];
                searchQuery.collaborators = [user.id];
            }

            const searchResult = await pm.searchTasks(searchQuery);
            res.json(searchResult);
        } catch (error) {
            next(error);
        }
    });

    // GET /api/search/suggestions - Get search suggestions
    app.get("/api/search/suggestions", authenticateToken, async (req: AuthContextRequest, res, next) => {
        try {
            const user = req.user as User;
            if (!user) {
                return res.status(401).json({ error: "Authentication required" });
            }

            const { q } = req.query;
            console.log(`[HTTP API] GET /api/search/suggestions - Getting suggestions for: ${q}`);

            if (!q || typeof q !== "string" || q.trim().length < 2) {
                return res.json({ suggestions: [] });
            }

            const allTasks = await pm.getAllTasks();

            const userManager = getUserManager();
            const hasAdminPermission = await userManager.hasPermission(user, "tasks", "read");
            let searchableTasks = allTasks;

            if (!hasAdminPermission) {
                searchableTasks = await pm.getTasksForUser(user.id, ["created", "assigned", "collaborating"]);
            }

            const suggestions = pm.generateSearchSuggestions(q, searchableTasks);
            res.json({ suggestions });
        } catch (error) {
            next(error);
        }
    });

    // Saved searches endpoints

    // GET /api/saved-searches - Get saved searches
    app.get("/api/saved-searches", authenticateToken, async (req: AuthContextRequest, res, next) => {
        try {
            const user = req.user as User;
            if (!user) {
                return res.status(401).json({ error: "Authentication required" });
            }

            console.log(`[HTTP API] GET /api/saved-searches - Getting saved searches for user: ${user.username}`);

            const savedSearches = await pm.getSavedSearches(user.id);
            res.json({ savedSearches, count: savedSearches.length });
        } catch (error) {
            next(error);
        }
    });

    // GET /api/saved-searches/:id - Get specific saved search
    app.get("/api/saved-searches/:id", authenticateToken, async (req: AuthContextRequest, res, next) => {
        try {
            const user = req.user as User;
            if (!user) {
                return res.status(401).json({ error: "Authentication required" });
            }

            const { id } = req.params;
            if (!id) {
                return res.status(400).json({ error: "Saved search ID is required" });
            }

            console.log(`[HTTP API] GET /api/saved-searches/${id} - Getting saved search`);

            const savedSearch = await pm.getSavedSearch(id, user.id);
            if (!savedSearch) {
                return res.status(404).json({ error: "Saved search not found" });
            }

            res.json({ savedSearch });
        } catch (error) {
            next(error);
        }
    });

    // POST /api/saved-searches - Create saved search
    app.post(
        "/api/saved-searches",
        authenticateToken,
        requirePermission("tasks", "update"),
        async (req: AuthContextRequest, res, next) => {
            try {
                const user = req.user as User;
                if (!user) {
                    return res.status(401).json({ error: "Authentication required" });
                }

                const searchInput = req.body as CreateSavedSearchInput;
                console.log(
                    `[HTTP API] POST /api/saved-searches - Creating saved search: ${searchInput.name} by user: ${user.username}`,
                );

                if (!searchInput.name || searchInput.name.trim().length === 0) {
                    return res.status(400).json({ error: "Saved search name is required" });
                }

                if (!searchInput.query) {
                    return res.status(400).json({ error: "Search query is required" });
                }

                const savedSearch = await pm.createSavedSearch(searchInput, user.id);
                res.status(201).json({ savedSearch });
            } catch (error) {
                next(error);
            }
        },
    );

    // PUT /api/saved-searches/:id - Update saved search
    app.put(
        "/api/saved-searches/:id",
        authenticateToken,
        requirePermission("tasks", "update"),
        async (req: AuthContextRequest, res, next) => {
            try {
                const user = req.user as User;
                if (!user) {
                    return res.status(401).json({ error: "Authentication required" });
                }

                const { id } = req.params;
                if (!id) {
                    return res.status(400).json({ error: "Saved search ID is required" });
                }

                const updateInput = req.body as UpdateSavedSearchInput;
                console.log(
                    `[HTTP API] PUT /api/saved-searches/${id} - Updating saved search by user: ${user.username}`,
                );

                const updatedSearch = await pm.updateSavedSearch({ id, ...updateInput }, user.id);
                res.json({ savedSearch: updatedSearch });
            } catch (error) {
                next(error);
            }
        },
    );

    // DELETE /api/saved-searches/:id - Delete saved search
    app.delete(
        "/api/saved-searches/:id",
        authenticateToken,
        requirePermission("tasks", "update"),
        async (req: AuthContextRequest, res, next) => {
            try {
                const user = req.user as User;
                if (!user) {
                    return res.status(401).json({ error: "Authentication required" });
                }

                const { id } = req.params;
                if (!id) {
                    return res.status(400).json({ error: "Saved search ID is required" });
                }

                console.log(
                    `[HTTP API] DELETE /api/saved-searches/${id} - Deleting saved search by user: ${user.username}`,
                );

                await pm.deleteSavedSearch(id, user.id);
                res.json({
                    success: true,
                    message: "Saved search deleted successfully",
                });
            } catch (error) {
                next(error);
            }
        },
    );
}
