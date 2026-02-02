# Add Widget to Dashboard - Storage and Placement

Date: 2026-02-03

## Decision
- Represent dashboard state as a validated, versionable model with Zod schemas.
- Compute widget placement deterministically via a first-fit grid scan to avoid overlap.
- Persist dashboard state via a storage abstraction with a JSON file implementation for session continuity.

## Rationale
- Zod schemas provide runtime validation for persisted state and ease future migrations.
- Deterministic placement prevents overlap while keeping the algorithm simple and predictable.
- A storage abstraction allows UI or service layers to plug in browser storage or server-side persistence.

## Consequences
- Placement is grid-based; finer layouts require a different algorithm.
- Callers must wire the storage implementation into UI or API layers.
