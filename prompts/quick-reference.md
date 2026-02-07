# Quick Reference: Agent Modes by Task Type

## 🎯 Mode Selection Guide

| Task Type | Recommended Mode | Description |
|-----------|------------------|-------------|
| **Planning & Design** | `architect` | System architecture, API design, database schemas |
| **Code Implementation** | `build` | Writing code, features, components, algorithms |
| **Analysis & Review** | `ask` | Code review, debugging, analysis, documentation |
| **Testing** | `build` | Writing tests, test automation, QA tasks |
| **Refactoring** | `build` | Code cleanup, optimization, modernization |
| **Documentation** | `ask` | Writing docs, specifications, guides |

## 🚀 Quick Commands

```bash
# Architecture planning
opencode run --mode architect "Design a microservices architecture for..."

# Feature implementation
opencode run --mode build "Implement user authentication with..."

# Code review
opencode run --mode ask "Review this authentication implementation for..."

# Testing
opencode run --mode build "Write unit tests for the user service..."

# Refactoring
opencode run --mode build "Refactor the user service to use dependency injection..."

# Documentation
opencode run --mode ask "Create API documentation for the user endpoints..."
```

## 📋 Task Management Integration

When working with complex tasks, use the MCP tools:

```bash
# Agent can create tasks for multi-step work
"Create a high-priority task to implement user authentication system"

# Agent can update task status
"Mark the authentication task as completed"

# Agent can prioritize work
"Set the database optimization task to high priority"
```

## 🧰 MCP Call Format (Important)
- Tool call args must be a JSON object.
- Use the exact tool name exposed by ACP runtime.
- In Codex ACP sessions, names are typically `functions.mcp__task-manager__<tool>`.
- Do not use bare names like `list_tasks` unless that exact bare name appears in the ACP tool list.
- Follow this order: read (`list_*`/`get_*`) -> write (`create_*`/`update_*`) -> verify.
- For important files, call `get_file_context` to create/update file context and ensure `FILE_CONTEXT` header linkage.

## 🔍 Monitoring Agent Work

Watch for these log patterns:
- `[ACP]` - Agent communication and tool usage
- `[APP]` - Task management operations
- Real-time streaming of agent thoughts and actions

## 📚 Available Prompt Categories

- **Architecture & Planning** - System design, APIs, databases
- **Implementation & Development** - Features, components, integrations
- **Testing & Quality** - Unit tests, integration tests, security
- **Refactoring & Maintenance** - Code cleanup, optimization, debt reduction
- **Documentation & Knowledge** - API docs, guides, specifications
- **Examples** - Ready-to-use prompts for common tasks

## ⚠️ Module Resolution (Critical)
- Runtime is Node ESM without transpilation. Always include the `.ts` extension on local TypeScript imports, e.g., `import { foo } from "./foo.ts"`. Missing extensions will crash the daemon/webapp; double-check imports before finishing.

## 🛑 Daemon Safety (Critical)
- Do not kill or restart the daemon process directly (no `pkill`, `kill`, or signals). Use the `restart_daemon` MCP tool when a restart is required.

## ✏️ Editing Best Practices

### Tool Selection
- **Use `edit`** for modifying existing code (preferred)
- **Use `write`** only for creating new files
- **Avoid** rewriting entire files when making changes

### Code Organization
- **Functions**: 20-50 lines target, 80 max
- **Files**: 100-200 lines target, refactor at 300+
- **Structure**: Group by domain, not by type
- **Naming**: Clear, descriptive, intention-revealing

### Refactoring Guidelines
- Make atomic changes - one logical thing per edit
- Extract complex logic into helpers
- Split large files by responsibility
- Keep directories shallow (max 3-4 levels)
