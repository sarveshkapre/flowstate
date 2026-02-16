# Architecture Overview

## Services

- `apps/web`: Next.js UI + API gateway
- `apps/worker`: async job processor (queue-driven)
- `packages/types`: shared contracts and schemas
- `packages/ui`: shared UI primitives

## Data Flow (v1)

1. Client uploads artifact (`image/*` or `application/pdf`) to web app.
2. Web API stores artifact metadata + bytes in `.flowstate-data/`.
3. Client creates extraction job (`invoice` or `receipt` template).
4. Web API runs OpenAI Responses extraction and validates result.
5. Completed jobs enter review queue (`pending` / `approved` / `rejected`).
6. Approved jobs export to CSV and/or outbound webhook.
7. Audit events and dataset snapshots are persisted for traceability and retraining.
8. Optional workflows orchestrate extraction + auto-review + webhook dispatch with run history.
9. Edge adapters package workflows as runtime-specific JSON bundles for external deployment systems.
10. Eval runs compute aggregate quality metrics across reviewed samples and persist benchmark history.
11. Organization records provide tenant scoping for workflows, edge bundles, and eval runs.

## Boundaries

- Web handles request/response and user interaction.
- Worker is reserved for asynchronous job execution as volume grows.
- Shared packages enforce type-safe contracts.
