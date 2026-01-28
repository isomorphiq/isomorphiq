# Monorepo Migration Plan (Yarn workspaces)

## Goals and guardrails
- Move to Yarn workspaces with a `packages/` directory to improve discoverability, maintenance, and ownership boundaries.
- Keep the daemon running; use the existing MCP tools if a restart is required.
- Preserve ES module resolution requirements: local imports must include `.ts` extensions and prefer pure functions over mutation.
- Maintain 4-space indentation and double quotes for strings in source files.

## Progress updates (current work)
- Packages now host domain code for core, tasks, workflow, auth, integrations, realtime, scheduling, http-api, and user-profile (profiles currently stubbed but exported from `@isomorphiq/user-profile`).
- ProductManager in `@isomorphiq/tasks` now owns saved searches, integration service wiring, and profile-facing APIs; integration DB opens during initialization and `getIntegrationService()` is available to callers.
- HTTP API handlers and TRPC router live in `packages/http-api`; shared middleware lives in `packages/api-prelude`; the HTTP server factory now lives in `packages/http-server` (Express + defaults) while domain handlers stay within their packages.
- SchedulingService moved into `@isomorphiq/scheduling` and tests/scripts point to the package; old `src/services/scheduling-service.ts` was removed.
- Daemon/process manager now import HTTP API, ProductManager, and WebSocketManager from workspace packages instead of local `src` paths.
- Path mappings in `tsconfig.base.json` cover all packages (including scheduling/analytics/plugins/acp/mcp/user-profile), and `yarn workspaces foreach -ptA run typecheck` passes across the workspace.
- Root CLI/daemon helper scripts (assign/handoff/claim/check/query/update/daemon/quick/etc.) now live under `packages/cli/scripts` alongside the CLI package.
- Legacy root integration/e2e scripts and domain docs were relocated into package-scoped `tests/` or `docs/` folders (analytics/auth/tasks/http-api/realtime/workflow/core), and the MCP server config now lives under `packages/mcp/config/`.

## Current state snapshot
- Single package rooted at `package.json` with many entry points: `packages/daemon/src/daemon.ts`, `packages/http-api/src/http-api-server.ts`, `packages/mcp/src/mcp-server.ts`, `packages/cli/src/cli-client.ts`, and numerous test scripts under `scripts/`.
- Domain code is mostly flat under `src/`: auth (`src/auth-service.ts`, `src/user-manager.ts`, `src/permission-service.ts`), tasks (`src/index.ts`, `src/task-service.ts`, `src/template-manager.ts`, `src/automation-rule-engine.ts`, `src/services/*`), workflow (`src/workflow-engine.ts`, `src/workflow.ts`, `src/workflow-factory.ts`, `src/routes/workflow-routes.ts`), integrations (`src/integrations/*`), plugin tooling (`src/plugin-*.ts`), HTTP/TRPC routes (`src/http/**`, `src/routes/**`), and real-time (`src/websocket-server.ts`); ACP connectors now live under `packages/acp`.
- Frontend React app in `packages/appshell/` using rsbuild.
- Data directories live at repository root (`db/`, `saved-searches-db/`, `test-db*/`).
- Tooling: TypeScript, ESLint, Biome formatter, tsx runner, LevelDB persistence, Playwright, @trpc, Effect, Express, WebSocket, React.

## Proposed workspace layout (domain oriented)
- `packages/core`: cross-cutting primitives and utilities (`src/core/*`, `src/logger.ts`, `src/logging/logger.ts`, `src/config/config.ts`, `src/git-utils.ts`, `src/process-spawner.ts`, shared types from `src/types.ts` and `src/types/*`).
- `packages/auth`: authentication and authorization (`src/auth-service.ts`, `src/user-manager.ts`, `src/permission-service.ts`, `src/repositories/authentication-repository.ts`, `src/repositories/auth-schema-manager.ts`, session helpers, security routes).
- `packages/user-profile`: profile management and metrics (`packages/user-profile/src/acp-profiles.ts`, `src/enhanced-profile-manager.ts`, profile analytics routes/tests, profile state helpers).
- `packages/tasks`: task domain, persistence, and automation (`src/index.ts` ProductManager, `src/task-service.ts`, `src/services/enhanced-task-service.ts`, `src/services/archive-service.ts`, `src/services/priority-update-manager.ts`, `src/automation-rule-engine.ts`, `src/template-manager.ts`, `src/repositories/task-repository.ts`, `src/repositories/leveldb-task-repository.ts`, `src/repositories/time-tracking-repository.ts`, `src/task-priority-enhancer.ts`, `src/task.ts`, `src/core/event-store.ts` usage).
- `packages/workflow`: workflow and approvals (`src/workflow-engine.ts`, `src/workflow.ts`, `src/workflow-factory.ts`, `src/core/approval-workflow.ts`, `src/routes/workflow-routes.ts`, `src/services/workflow-service.ts`, `src/services/workflow-templates.ts`, `src/services/approval-workflow-service.ts`, `src/routes/approval-workflow-routes.ts`).
- `packages/scheduling`: scheduling and resource management (`src/services/scheduling-service.ts`, `src/routes/scheduling-routes.ts`, `src/services/resource-management-service.ts`, `src/services/time-tracking-service.ts`, `src/core/time-tracking.ts`, scheduling analytics endpoints).
- `packages/analytics`: reporting, dashboards, and metrics (`src/http/routes/metrics-routes.ts`, `src/routes/security-routes.ts` analytics handlers, `src/services/task-3-implementation.ts` analytics section, analytics-related scripts under `scripts/test-analytics-*.ts`, `scripts/test-dashboard-*.ts`, `scripts/test-reports-*.ts`).
- `packages/integrations`: external adapters and integration orchestration (`src/integrations/*`, `src/routes/integration-routes.ts`, `src/services/collaboration-service.ts`, `src/services/automation-rule-engine.ts` external triggers).
- `packages/plugins`: plugin framework for profiles (`src/plugin-system.ts`, `src/plugin-loader.ts`, `src/plugin-manager.ts`, `src/plugin-sandbox.ts`, `src/enhanced-profile-manager.ts` plugin hooks, documentation from `PLUGIN_SYSTEM_GUIDE.md`).
- `packages/acp`: Agent Client Protocol connectors (`packages/acp/src/acp-client.ts`, `packages/acp/src/acp-connection.ts`, `packages/acp/src/acp-session.ts`, `packages/acp/src/effects/acp-cleanup.ts`, `packages/acp/src/effects/acp-turn.ts`, `comprehensive-unlock-solution.ts` touchpoints).
- `packages/mcp`: MCP server and tooling (`packages/mcp/src/mcp-server.ts`, `packages/mcp/tests/test-mcp-server.js`, `packages/mcp/tests/start-mcp-server.js`, `mcp-config.md`, `opencode-mcp-setup.md`).
- `packages/http-api`: REST/TRPC handlers (`src/http/**`, `src/routes/**`, `src/services/enhanced-websocket-server.ts`).
- `packages/api-prelude`: shared API middleware (auth, authorization, validation, rate limiting, error handling, request logging).
- `packages/http-server`: Express/WS server factory wiring the domain handlers and TRPC router with sensible defaults.
- `packages/realtime`: websocket management (`src/websocket-server.ts`, `src/websocket-event-bridge.ts`, `src/services/process-manager.ts` if tied to socket orchestration).
- `packages/daemon`: long-running processor (`packages/daemon/src/daemon.ts`, `packages/daemon/src/daemon-enhanced.ts`, daemon scripts, data bootstrap `src/init.ts`, CLI controls like `daemon-handoff*.js`, `daemon-unlock*.ts`).
- `packages/cli`: command-line utilities (`packages/cli/src/cli-client.ts`, root `assign-*.js`, `claim-*.js`, `handoff-*.js`, `unlock-accounts.ts`, `scripts/test-runner.js` where appropriate).
- `packages/appshell`: React frontend currently in `packages/appshell/` (can live under `packages/appshell` or `apps/web` with rsbuild config).

Notes:
- Some files will shift between proposed packages once dependency analysis is finished (for example, `src/product-manager.ts` likely belongs to `packages/tasks` while CLI launchers live in `packages/cli`).
- Data directories (`db/`, `saved-searches-db/`, `test-db*/`) should move under a shared `var/` or `data/` directory referenced via config in `packages/core`.

## Migration phases
1. Preparation
    - Freeze daemon restarts; communicate planned downtime if data directories move.
    - Audit dependencies and scripts in `package.json` and `yarn.lock`. Remove `package-lock.json` once Yarn is the single source of truth.
    - Document required Node version, Yarn version (already set to `yarn@4.6.0`), and environment variables.
2. Workspace bootstrap (no code moves yet)
    - Ensure `workspaces` are defined in `package.json` and `.yarnrc.yml` uses the intended linker.
    - Create a root `tsconfig.base.json` and update package-specific `tsconfig.json` files to extend it while keeping `.ts` extensions in emitted imports.
    - Move lint/typecheck/tooling configs to the root where possible (ESLint, Biome, rsbuild shared presets) while preserving existing rules.
    - Update root scripts to `yarn run lint`, `yarn run test`, `yarn run build`, and add `yarn workspaces foreach -ptA run` equivalents.
3. Package scaffolding
    - For each package above, add `package.json` with `"type": "module"`, explicit `exports`, and intra-workspace dependencies.
    - Set build outputs to `dist/` inside each package; add `tsconfig.build.json` per package where needed.
    - Establish shared code ownership by mapping maintainers to packages in `CODEOWNERS` (if added later).
4. Code moves by domain
    - Start with `packages/core` to provide stable imports for other packages.
    - Migrate low-level shared modules (types, result, event bus, logging, config, process utilities).
    - Move task and workflow domains next (`packages/tasks`, `packages/workflow`, `packages/scheduling`) because most services depend on them; adjust imports to point to package entry files with `.ts` extension.
    - Extract auth and profile packages; update routes and services to consume the new package entrypoints.
    - Relocate integrations, plugin, ACP, and MCP code; ensure their tests move alongside.
    - Shift HTTP/TRPC routes into `packages/http-api`; re-export routers for consumption by the daemon and CLI packages.
    - Move daemon, CLI, and web apps into `apps/` or package folders while wiring them to workspace dependencies.
5. Data and configuration alignment
    - Centralize data paths in `packages/core` config (e.g., `var/data/db`, `var/data/saved-searches-db`) and update consumers.
    - Ensure runtime scripts and systemd/unit files (if any) reference the new paths and workspace binaries (`yarn workspace @isomorphiq/daemon run start`).
6. Testing and verification
    - Update test scripts to use workspace run commands (`yarn workspaces foreach -ptA run test` or `yarn workspace @isomorphiq/tasks run test`).
    - Verify automation scripts and dashboards under `scripts/` point to package-local entrypoints.
    - Run format/lint/typecheck across the workspace; use `rg 'from "./' src packages/appshell/src | rg -v '\\.ts\"'` after moves to catch missing extensions.
7. Cleanup and documentation
    - Remove obsolete scripts or aliases replaced by package-level commands.
    - Update README and domain docs (auth, automation, scheduling, plugin system) to reflect new package locations.
    - Add contributor notes about Yarn usage, workspace scripts, and daemon operation.

## Package responsibilities and file mapping (first pass)
- Core: `src/core/**`, `src/types.ts`, `src/types/**`, `src/logger.ts`, `src/logging/logger.ts`, `src/config/config.ts`, `src/git-utils.ts`, `src/process-spawner.ts`, `src/dependency-validator.ts`, `src/result.ts`.
- Auth: `src/auth-service.ts`, `src/user-manager.ts`, `src/permission-service.ts`, `src/security-service.ts`, `src/services/enhanced-rbac-service.ts`, `src/repositories/authentication-repository.ts`, `src/repositories/auth-schema-manager.ts`, security routes in `src/http/routes/auth-routes.ts` and `src/routes/security-routes.ts`, related tests in `scripts/test-auth-*.ts`.
- User-profile: `packages/user-profile/src/acp-profiles.ts`, `src/enhanced-profile-manager.ts`, profile routes (`src/http/routes/profile-routes.ts`), profile analytics pages in `packages/appshell/src/pages/ProfileAnalyticsPage.tsx`.
- Tasks: `src/index.ts`, `src/product-manager.ts`, `src/task-service.ts`, `src/services/enhanced-task-service.ts`, `src/services/task-3-implementation.ts`, `src/services/archive-service.ts`, `src/services/priority-update-manager.ts`, `src/task-priority-enhancer.ts`, `src/core/task.ts`, `src/core/event-store.ts`, task routes (`src/http/routes/task-routes.ts`), and associated tests (`scripts/test-rest-api*.ts`, `scripts/test-data-consistency.ts`, `test-advanced-search.ts`).
- Current moves: `@isomorphiq/tasks` now exports ProductManager with saved search persistence, integration service wiring, and stubbed profile accessors for HTTP routes.
- Workflow: `src/workflow-engine.ts`, `src/workflow.ts`, `src/workflow-factory.ts`, `src/services/workflow-service.ts`, `src/services/workflow-templates.ts`, `src/core/approval-workflow.ts`, `src/routes/workflow-routes.ts`, `src/routes/approval-workflow-routes.ts`, tests like `scripts/test-workflow-automation.ts`.
- Scheduling: `src/services/scheduling-service.ts`, `src/routes/scheduling-routes.ts`, `src/services/resource-management-service.ts`, `src/core/time-tracking.ts`, `src/services/time-tracking-service.ts`, `scripts/test-scheduling-system.ts`.
- Current moves: SchedulingService now lives in `packages/scheduling/src/scheduling-service.ts` and HTTP routes are mounted from `packages/http-api`.
- Analytics: `src/http/routes/metrics-routes.ts`, analytics logic inside scheduling/time-tracking services, dashboard scripts (`scripts/test-analytics-*.ts`, `scripts/test-dashboard-*.ts`, `scripts/test-report-generation.ts`), web analytics pages (`packages/appshell/src/pages/AnalyticsPage.tsx`).
- Integrations: `src/integrations/*`, `src/routes/integration-routes.ts`, `src/services/collaboration-service.ts`, `src/services/automation-rule-engine.ts` hooks for external services.
- Plugins: `src/plugin-system.ts`, `src/plugin-loader.ts`, `src/plugin-manager.ts`, `src/plugin-sandbox.ts`, plus documentation (`PLUGIN_SYSTEM_GUIDE.md`).
- ACP: `packages/acp/src/acp-client.ts`, `packages/acp/src/acp-connection.ts`, `packages/acp/src/acp-session.ts`, `packages/acp/src/effects/acp-cleanup.ts`, `packages/acp/src/effects/acp-turn.ts`.
- MCP: `packages/mcp/src/mcp-server.ts`, `packages/mcp/tests/start-mcp-server.js`, `packages/mcp/tests/test-mcp-server.js`, `mcp-config.md`, `opencode-mcp-setup.md`, plus any MCP tools in HTTP/daemon wiring.
- HTTP API: `src/http-api-server.ts`, `src/http/**`, `src/routes/**`, TRPC setup in `src/http/trpc.ts` (all domain handlers should live in their domain packages; shared middleware belongs in an api-prelude util when needed).
- Current moves: HTTP API server, routes, and TRPC handlers live in `packages/http-api/src/**` and depend on workspace packages for auth/tasks/workflow/integrations/realtime/scheduling.
- Realtime: `src/websocket-server.ts`, `src/services/enhanced-websocket-server.ts`, `src/websocket-event-bridge.ts`, websocket client in `src/test-websocket-client.ts`.
- Daemon: `packages/daemon/src/daemon.ts`, `packages/daemon/src/daemon-enhanced.ts`, runtime helpers in `daemon-*.js` scripts, `src/init.ts`.
- CLI: `packages/cli/src/cli-client.ts`, operational scripts at repo root (`assign-*.js`, `claim-*.js`, `handoff-*.js`, `unlock-accounts.ts`, `check-*.js`, etc.), test runner `scripts/test-runner.js`.
- Web app: everything under `packages/appshell/`, rsbuild configs (`rsbuild.config.*`), front-end atoms/components/pages.

## Yarn-specific steps
- Replace npm usage in docs and scripts with Yarn equivalents (`yarn install`, `yarn run daemon`, `yarn workspace @isomorphiq/mcp run start`).
- Tune `.yarnrc.yml` only if needed for registry or linker tweaks; prefer `node-modules` linker to match runtime expectations.
- Use workspace protocol (`"workspace:*"`) for internal deps to keep versions aligned.
- Ensure build outputs are excluded from package dependency graphs (set `"files"` and `.npmignore` or `exports` properly).

### Script mapping (npm → Yarn workspaces)
- `yarn run daemon` → `yarn workspace @isomorphiq/daemon run start` (package script to be defined)
- `yarn run http-api` → `yarn workspace @isomorphiq/http-api run start`
- `yarn run mcp-server` → `yarn workspace @isomorphiq/mcp run start`
- `yarn run cli` → `yarn workspace @isomorphiq/cli run start`
- `yarn run web:dev` → `yarn workspace @isomorphiq/web run dev` (once web app is a workspace)
- `yarn run test` → `yarn workspaces foreach -ptA run test`
- `yarn run lint` → `yarn workspaces foreach -ptA run lint`

## Validation checklist after migration
- `yarn install` works from a clean clone, produces deterministic `yarn.lock`, and does not regenerate `package-lock.json`.
- `yarn workspaces foreach -ptA run lint`, `yarn workspaces foreach -ptA run typecheck`, and critical tests pass (daemon, MCP server, web smoke tests).
- Entry points start from package binaries: `yarn workspace @isomorphiq/daemon run start`, `yarn workspace @isomorphiq/http-api run start`, `yarn workspace @isomorphiq/mcp run start`, `yarn workspace @isomorphiq/cli run start`, `yarn workspace @isomorphiq/web run dev`.
- Imports retain `.ts` extensions across packages; `rg 'from \"./' packages apps | rg -v '\\.ts\"'` returns empty.
- Daemon and MCP server continue to read/write LevelDB in the configured data path without schema changes.

## Open questions to resolve during implementation
- Do we keep `apps/` separate from `packages/` or treat runtime services as packages with `"bin"`/`"types"` exports?
- Should LevelDB instances remain per service or be centralized with a shared connection utility?
- How do we handle legacy compiled assets in `dist/` once each package builds independently (keep one top-level `dist/` aggregator or per-package `dist/`)?
- Which scripts remain necessary after consolidating CLI entrypoints into a dedicated package?
