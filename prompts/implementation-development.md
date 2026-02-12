# Implementation & Development Prompts

## Feature Implementation Prompt
```
Implement [FEATURE NAME] with the following requirements:
- [SPECIFIC REQUIREMENT 1]
- [SPECIFIC REQUIREMENT 2]
- [SPECIFIC REQUIREMENT 3]

Use [FRAMEWORK/LANGUAGE] and follow these patterns:
- [CODING PATTERN 1]
- [CODING PATTERN 2]
- [TESTING APPROACH]

Ensure proper error handling, logging, and documentation.
```

## Component Development Prompt
```
Create a reusable [COMPONENT TYPE] component for [PURPOSE]. Requirements:
- Props/interface definition
- State management approach
- Event handling
- Styling strategy
- Accessibility compliance
- Unit test coverage

Follow [FRAMEWORK] best practices and provide usage examples.
```

## Algorithm Implementation Prompt
```
Implement [ALGORITHM NAME] algorithm with these specifications:
- Time complexity: O([COMPLEXITY])
- Space complexity: O([COMPLEXITY])
- Input validation
- Edge case handling
- Performance optimizations

Provide comprehensive test cases and performance benchmarks.
```

## Integration Implementation Prompt
```
Implement integration between [SYSTEM A] and [SYSTEM B]. Requirements:
- Authentication and authorization
- Data transformation and mapping
- Error handling and retry logic
- Monitoring and logging
- Rate limiting and throttling

Use [PROTOCOL/STANDARD] for communication and ensure backward compatibility.
```

## Implementation Ticket Authoring Prompt
```
Create [N] implementation tickets for [STORY/FEATURE].

Ticket quality requirements:
- Each ticket must be execution-ready (no unresolved architecture decisions).
- Keep task descriptions under 2000 characters (target 900-1800).
- Use concrete, repo-relative file paths and explain why each file is relevant.
- Include APIs/contracts and example payloads whenever the change crosses service boundaries.
- Include gotchas/interactions, testing guidance, and future-state notes.
- Follow AGENTS.md constraints (4-space indentation, double quotes, functional style, .ts local import extensions).

For each ticket, use this description structure:
Objective/User Impact: ...
Scope: ...
Non-goals: ...
Relevant Files:
- path/to/file.ts - why relevant
APIs/Contracts:
- METHOD /api/path or interface/event details
Example Payloads:
- {"example":"value"}
Implementation Plan:
1) ...
Gotchas/Interactions:
- ...
Testing:
- Unit: ...
- Integration/E2E: ...
- Commands: ...
Future Notes:
- ...
```

## Module Resolution Note
- The runtime is Node ESM with no transpilation. Always include the `.ts` extension on local TypeScript imports, e.g., `import { foo } from "./foo.ts"`. Missing extensions will break the app.

## Atomic Editing Guidelines

When implementing features or making changes:

**Tool Selection:**
- **Prefer `edit` over `write`**: Use targeted edits for existing files rather than rewriting entire files
- **Scope each edit**: One edit should change one logical thing (a function, a configuration, a type)
- **Avoid large payloads**: Keep edit changes under 50 lines when possible

**Function Design:**
- **Single Responsibility**: Each function should do exactly one thing
- **Size limits**: Aim for 20-50 lines per function; never exceed 80 lines
- **Extraction**: Pull complex logic into helper functions with descriptive names
- **Readability**: Functions should be understandable at a glance

**File Organization:**
- **Small files**: Target 100-200 lines per file; refactor when exceeding 300 lines
- **Focused content**: Each file should contain 1-2 highly related functions or a single cohesive unit
- **Clear naming**: Files should be named after their primary responsibility
- **Directory structure**: Group by domain/feature, not by type (avoid `utils/`, `helpers/` dumping grounds)

**Implementation Workflow:**
1. Read and understand existing code structure
2. Plan minimal changes needed (prefer adding new files over modifying large existing ones)
3. Make atomic edits - one logical change per tool call
4. Verify each change before proceeding to the next
5. Refactor incrementally rather than in large rewrites

## MCP Tool Usage (Implementation)
- Tool-name resolution SOP:
  - Read the ACP tool list first.
  - Use exact visible names; in Codex ACP this is usually `functions.mcp__task-manager__<tool>`.
  - Do not call bare names like `list_tasks` unless that exact bare name is visible.
- Read phase (once):
  - `functions.mcp__task-manager__list_tasks` and `functions.mcp__task-manager__get_task` to gather ids and state.
- Write phase:
  - `functions.mcp__task-manager__update_task_status`, `functions.mcp__task-manager__update_task`, `functions.mcp__task-manager__update_context`, `functions.mcp__task-manager__create_task` as needed.
- File-context phase:
  - Call `functions.mcp__task-manager__get_file_context` when a file is materially relevant.
  - Include `operation`, `taskId`, `reason`, `relatedFiles`, and `todos` when available.
  - Expect `headerUpdated: true|false` and `// FILE_CONTEXT: "context-..."` linkage.
- Verify phase:
  - Re-check with `get_task`/`list_tasks` after major writes when confirmation is required.
