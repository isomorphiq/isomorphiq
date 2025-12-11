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
