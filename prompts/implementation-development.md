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

## Module Resolution Note
- The runtime is Node ESM with no transpilation. Always include the `.ts` extension on local TypeScript imports, e.g., `import { foo } from "./foo.ts"`. Missing extensions will break the app.

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
