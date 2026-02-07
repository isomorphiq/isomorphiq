# Daemon Refactor Plan (Worker-First)

## Goal
Turn the daemon into a stateless worker that can scale horizontally (multiple workers processing tickets simultaneously) without shared-state contention. All durable/shared state and orchestration should live behind microservices.

## Current State (High-Level)
- Tasks state is now owned by the tasks microservice (tRPC + LevelDB lock).
- The daemon still owns shared/global state and orchestration logic (saved searches, templates, automation rules, integrations, scheduling, analytics).

## Target Architecture
- **Tasks Microservice**: task-only logic (dependencies, validation, search, task events).
- **Gateway**: orchestration layer that aggregates across services, runs cross-service flows.
- **Workers (Daemon)**: stateless job executors; no shared DB access.
- **Event stream**: task state changes broadcast for automation/workflow.

## Services to Extract (Ordered)

### 1) Templates + Saved Searches + Automation Rules Service
These are shared state, currently hanging off ProductManager with LevelDB.

Why:
- Shared mutable state across workers.
- Required for orchestration decisions.
- Blocks horizontal scaling if the daemon owns persistence.

Expected endpoints:
- CRUD templates
- CRUD saved searches
- CRUD automation rules
- Execute saved search (returns task ids)

Notes:
- Can be a single "task metadata service" or split by domain.

### 2) Integrations Service
Integration tokens, sync metadata, and external system state cannot live inside a worker.

Why:
- Shared state (tokens, sync cursors).
- Needs robust retry/backoff, rate limit handling.

Expected endpoints:
- Integrations CRUD
- Token storage
- Trigger sync jobs

### 3) Workflow Orchestration Service
Move automation/workflow execution and state transitions out of the daemon.

Why:
- Orchestration requires shared state and deterministic execution.
- Multiple workers need a canonical source of truth.

Expected endpoints:
- Start workflow
- Advance workflow step
- Get workflow state
- Emit workflow events

### 4) Scheduler / Dispatcher Service
Workers need a lease-based queue so they do not race on work items.

Why:
- Multi-worker safety (leases, retries, backoff).
- Enables concurrency and prioritization.

Expected endpoints:
- Enqueue work item
- Lease work items
- Ack/fail work items
- Retry and dead-letter

### 5) Analytics / Reporting Service (Optional Early, Required Eventually)
Global aggregation does not belong in workers.

Why:
- Shared state, heavy compute, cross-service joins.
- Should be queried by gateway/UI, not workers.

Expected endpoints:
- Task analytics
- Workflow analytics
- Aggregated progress metrics

## Daemon (Worker) Responsibilities After Extraction
- Poll dispatcher for work items.
- Perform work idempotently.
- Call tasks service to mutate tasks.
- Call workflow service for orchestration transitions.
- Call integrations service for side effects.
- Emit structured logs/events.

## Required Cross-Cutting Concerns
- **Idempotency**: every work item should carry a unique idempotency key.
- **Leases**: work items must use lease tokens + expiry to prevent double processing.
- **Outbox/Event Stream**: publish task and workflow changes for automation/reactive systems.
- **Backoff/Retry Policies**: centralized at dispatcher; workers are dumb executors.

## Proposed Migration Order
1) Extract templates/saved searches/automation rules service.
2) Extract integrations service.
3) Build dispatcher service + lease protocol.
4) Move workflow orchestration into workflow service.
5) Move analytics out of daemon into analytics service.
6) Reduce daemon to worker-only and remove all LevelDB usage.

## Success Criteria
- Multiple daemon instances can run concurrently.
- No shared LevelDB access by workers.
- All shared state owned by microservices.
- Gateway aggregates across services for UI and MCP.

## Open Questions
- Should templates/saved searches/automation be separate services or a single "task metadata" service?
- Should dispatcher live inside workflow service or be its own service?
- Should gateway orchestrate workflows directly or only route to workflow service?
