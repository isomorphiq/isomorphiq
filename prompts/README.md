# Agent Work Prompts

This directory contains various prompt templates for instructing the OpenCode agent to perform different types of work. Each prompt is designed for specific task categories and recommends appropriate agent modes.

## Agent Modes

- **build** - Default mode for implementation and coding tasks
- **ask** - For analysis, planning, and informational tasks
- **architect** - For system design and architecture planning

## Task Categories

### 🏗️ Architecture & Planning (`architecture-planning.md`)
**Recommended Mode:** `architect` or `ask`
- System design and architecture
- API design specifications
- Database schema design
- Component relationship planning

### 💻 Implementation & Development (`implementation-development.md`)
**Recommended Mode:** `build`
- Feature implementation
- Component development
- Algorithm implementation
- System integration

### 🧪 Testing & Quality Assurance (`testing-quality.md`)
**Recommended Mode:** `build`
- Unit testing
- Integration testing
- Security testing
- Performance testing

### 🔄 Refactoring & Maintenance (`refactoring-maintenance.md`)
**Recommended Mode:** `build`
- Code refactoring
- Legacy code modernization
- Performance optimization
- Technical debt reduction

### 📚 Documentation & Knowledge (`documentation-knowledge.md`)
**Recommended Mode:** `ask` or `build`
- API documentation
- Code documentation
- User guides
- Technical specifications

## Usage Instructions

1. **Choose the appropriate prompt template** based on your task type
2. **Set the agent mode** using the recommended mode for that category
3. **Fill in the template variables** (shown in [BRACKETS])
4. **Provide specific requirements** and context
5. **Execute the task** and monitor agent activity via the logging

## Example Usage

```bash
# For a planning task
opencode run --mode architect "Design a RESTful API for user management..."

# For implementation
opencode run --mode build "Implement user authentication with JWT tokens..."

# For testing
opencode run --mode build "Write unit tests for the user service..."
```

## Task Management Integration

All prompts work with the MCP task management server. The agent can:
- Create tasks for complex multi-step work
- Update task status as work progresses
- Prioritize tasks based on importance
- Track completion and dependencies

## Best Practices

1. **Be specific** - Provide detailed requirements and constraints
2. **Include context** - Reference existing code, patterns, and standards
3. **Specify technologies** - Mention frameworks, libraries, and tools
4. **Define success criteria** - What constitutes completion
5. **Request deliverables** - Tests, documentation, examples
6. **Module resolution** - Node runs ESM with no transpilation; all local TS imports must include the `.ts` extension (e.g., `import { foo } from "./foo.ts"`). Omitting extensions will break the app.

## Monitoring Agent Work

The system provides comprehensive logging of agent activities:
- `[ACP]` - Agent Client Protocol communication
- `[APP]` - Application-level task management
- Real-time streaming of agent thoughts and actions
- Tool usage and execution results
