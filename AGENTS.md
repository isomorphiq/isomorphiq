# Agent Guidelines

## Task Manager Daemon

The task-manager daemon (`yarn run daemon`) is a long-running background process that:

- Manages task storage in LevelDB
- Processes tasks continuously by spawning opencode instances
- Provides TCP API on port 3001 for task operations

**Important:** Do NOT kill or restart the daemon unless absolutely necessary. It is a shared service that other agents and processes may be interacting with. The daemon should remain running continuously.

### Starting the Daemon

To start the daemon, run `yarn run daemon` in the project directory. This will start the background process that manages tasks.

If the daemon is already running, do not kill it. Instead, use the `restart_daemon` MCP tool to gracefully restart it. You must wait until the daemon confirms it has restarted before proceeding. Do not send signals (like SIGKILL) directly to the daemon process.

### Checking Daemon Status

Use the `check_daemon_status` MCP tool to verify if the daemon is running without disrupting it.

### Task Processing

The daemon automatically processes tasks in priority order:
1. High priority tasks first
2. Then medium, then low
3. Tasks are marked as "in-progress" during processing
4. Completed tasks are marked as "done"

If you need to intervene with task processing, use the MCP tools to update task status rather than killing the daemon.

## Coding style:

This application runs directly in node with no transpilation, so relative imports of typescript files must use the full path to the file, including extension.
Since most source files for this application are ts, that means `import * as Something from "./things/something.ts"`

If you ever add or edit imports, always include the `.ts` extension on local modules. Missing extensions break runtime resolution (ESM) and will crash the daemon/webapp. Do a quick `rg 'from "./' src packages/appshell/src packages services | rg -v '\\.ts\"'` before finishing to catch mistakes.

Use functional programming style that avoids mutation of data.

4-space indentation (...we are not heathen)
use `"` double quotes for quoting strings; eg do not use `'` apostrophes; (again... we are not heathen.)
Prefer struct/trait/impl from `@tsimpl/*` with `StructSelf` types; avoid interfaces, type casts, and `z.infer` in favor of zod schemas + type aliases.

## Domain packaging

- Organize by domain, not by implementation detail. Each domain package should colocate its datatypes, validation schemas, and trait implementations together.
- Avoid creating "types-only" or "validation-only" packages. If a domain needs types and validation, they live side-by-side in that domain package.
- Exports should flow from the domain package entrypoint so other packages import from the domain package, not internal files.
