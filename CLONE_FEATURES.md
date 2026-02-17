# Clone Feature Tracker

## Context Sources
- README and docs
- API routes in `apps/web/src/app/api`
- Shared schemas in `packages/types/src/index.ts`

## Candidate Features To Do
- v2 UI for projects/members/keys.
- v2 flow graph editor with node palette and edge constraints.
- v2 run trace visualizer and replay diff UX.
- Structured evidence annotation canvas.
- Connector delivery retry/idempotency hardening.

## Implemented
- v2 project APIs: create/list/get + member assignment + API key issuance.
- v2 auth foundations: magic-link request/verify and strict/optional auth modes.
- v2 flow APIs: flow create/list, version create/list, deployment create/list.
- v2 runtime APIs: webhook source execution, run list/get/trace.
- v2 datasets: dataset create/list, dataset version create/list, replay execution.
- v2 review APIs: field decision records + evidence region attach/list.
- v2 active learning: candidate scoring + eval pack create/list.
- v2 connector and edge ingress scaffolding.
- v2 Flow Builder UI for graph authoring, versioning, deployment, and runtime webhook testing.
- v2 replay diff/accuracy summary with optional baseline flow-version comparison.

## Insights
- Control-plane API scaffolding is now broad enough to support rapid UI work.
- v2 runtime execution currently uses deterministic node transforms and should be expanded for richer model-driven operators.

## Notes
- Keep v1 endpoints stable during v2 iteration.
