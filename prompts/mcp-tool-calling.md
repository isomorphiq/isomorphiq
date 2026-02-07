# MCP Tool Calling SOP

Use this guide whenever a workflow step requires MCP tools.

## 1. How to Call Tools
- The ACP tool list is authoritative for the current turn.
- Do not claim the tool list is inaccessible when tools are visible there.
- Use the exact tool name exposed in the ACP turn.
- In OpenCode sessions, tools are often exposed as `task-manager_<tool>` (for example: `task-manager_list_tasks`).
- In Codex ACP sessions, MCP tools are commonly exposed as `functions.mcp__<server>__<tool>` (for example: `functions.mcp__task-manager__list_tasks`).
- Do not call bare names such as `list_tasks` unless that exact bare name appears in the visible tool list.
- Pass a JSON object as the tool arguments.
- Do not wrap arguments in markdown/code fences.
- One tool call per action; avoid batching unrelated writes.
- For task-graph transitions (prioritization, refinement, implementation-task creation), do not use shell/execute tools unless the step explicitly requires command execution.
- For task-graph transitions, do not use MCP resource-discovery calls (`codex/list_mcp_resources`, `*/read_mcp_resource`) as substitutes for task-manager operation tools.

### Common Codex Mappings
- `list_tasks` -> `functions.mcp__task-manager__list_tasks`
- `get_task` -> `functions.mcp__task-manager__get_task`
- `create_task` -> `functions.mcp__task-manager__create_task`
- `update_task` -> `functions.mcp__task-manager__update_task`
- `update_task_status` -> `functions.mcp__task-manager__update_task_status`
- `get_file_context` -> `functions.mcp__task-manager__get_file_context`
- `update_context` -> `functions.mcp__task-manager__update_context`

If a profile/runtime exposes different names (for example OpenCode or custom MCP server aliases), use the exact visible names from that turn.

### Common OpenCode Mappings
- `list_tasks` -> `task-manager_list_tasks`
- `get_task` -> `task-manager_get_task`
- `create_task` -> `task-manager_create_task`
- `update_task` -> `task-manager_update_task`
- `update_task_priority` -> `task-manager_update_task_priority`

## 2. When to Call Tools
- Read first:
  - Use `list_*` and `get_*` to gather current state and ids.
- Write second:
  - Use `create_*`, `update_*`, `replace_*`, `delete_*` only after targets are known.
- Verify last:
  - Re-check with `get_*` or `list_*` when the transition requires confirmation.

## 3. What to Expect in Responses
- `list_*`: count/summary text plus record-like entries.
- `get_*`: full record payload or not-found error.
- `create_*`: created record with generated id.
- `update_*` / `replace_*`: updated record payload.
- `delete_*`: success confirmation text.

## 4. File Context Tool (`get_file_context`)
Call `get_file_context` when a file is materially relevant to the current task (especially before or during edits).

Recommended args:
```json
{
    "filePath": "packages/workflow/src/agent-runner.ts",
    "operation": "begin-implementation",
    "taskId": "task-...",
    "taskTitle": "Implement ...",
    "reason": "Core prompt assembly logic",
    "relatedFiles": ["packages/profiles/src/acp-profiles.ts"],
    "todos": ["add test coverage for ..."]
}
```

Expected behavior:
- Returns/creates a file context record.
- Ensures file header is present:
  - `// FILE_CONTEXT: "context-..."`
- Response includes whether header changed (`headerUpdated: true|false`).

## 5. Failure Handling
- Only report a required tool as unavailable when that specific tool name is absent from the visible ACP tool list.
- Continue with available evidence and provide exact follow-up tool call(s) needed.
