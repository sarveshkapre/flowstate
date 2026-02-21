# Product Roadmap

## Product Goal
Build a managed SaaS-first, OpenAI-native computer vision operations platform that reaches Roboflow-level workflow capability and exceeds it with Codex-native automation.

## Definition Of Done
- Core flow builder, dataset versioning, review UX, active learning, and edge runner delivered.
- Multi-tenant permission boundaries and auditability in place.
- v2 public APIs stable for project/flow/run/dataset/review/edge surfaces.
- Documentation and migration paths are complete.

## Milestones
- M1 SaaS Control Plane Foundations
- M2 Flow Builder v1 + Deploy
- M3 Dataset + Run Versioning v1
- M4 Structured Review UX v1
- M5 Active Learning v2
- M6 Edge Runner Agent v1
- M7 Codex-Native Differentiation

## Current Milestone
- M2 Flow Builder v1 + Deploy (in progress)

## Pending Features
- Expand automated test coverage across worker/jobs and v1 extraction/review APIs.

## Delivered Features
- 2026-02-21: Bulk connector queue operations shipped with a project-level process-all endpoint and Flow Builder control for one-click multi-connector draining.
- 2026-02-21: Connector reliability insights shipped with a new v2 insights API and Flow Builder visibility into success rates, attempt efficiency, and top recurring delivery errors.
- 2026-02-21: Connector test endpoint now supports live dispatch mode, enabling real transport smoke tests from Flow Builder before production rollout.
- 2026-02-21: Review alert policy UX expanded with queue-limit and idempotency-window controls wired through policy save, preview, and manual dispatch.
- 2026-02-21: Connector type hardening shipped with canonical type parsing (including aliases), worker-side unsupported type filtering, and Flow Builder connector selectors for safer operations.
- 2026-02-21: Production connector transport coverage expanded to SQS + DB ingest connectors, with worker pump/redrive defaults, runtime validation, and Flow Builder config templates.
- 2026-02-21: Review alerts API is now policy-aware, resolving thresholds/connector settings from request overrides, saved project policy, or defaults for consistent external automation behavior.
- 2026-02-21: Project-level review alert policies shipped with persisted thresholds/connector settings, Flow Builder save/load controls, and worker-side policy-aware automation fallback.
- 2026-02-21: Review Alerts control surface shipped with preview+dispatch APIs and Flow Builder threshold tuning for manual verification before automation rollout.
- 2026-02-21: Connector dead-letter auto-recovery shipped with batch redrive API/action, reset-safe retry state, and worker-driven redrive+process automation.
- 2026-02-21: v1 extraction/review request validation helper shipped with unit coverage for filter parsing and review action payloads.
- 2026-02-21: Review alert automation shipped with worker-side backlog threshold monitoring and connector-dispatched ops alerts.
- 2026-02-21: Active Learning Workbench shipped in Flow Builder with ranked candidates, one-click eval pack creation, and eval pack history tracking.
- 2026-02-21: Review Ops queue dashboard shipped with project-level unreviewed/at-risk/stale prioritization, queue health scoring, and Flow Builder triage controls.
- 2026-02-21: Review queue analytics shipped with decision summary metrics, failure hotspots, and field-level error concentration surfaced in API + Flow Builder.
- 2026-02-21: Worker-backed connector queue pump shipped with auto-drain polling, per-project processing, and strict-mode API key support.
- 2026-02-21: Connector queue control shipped with enqueue mode, bounded batch processing, and dead-letter redrive actions.
- 2026-02-21: Production connector transports shipped for webhook/slack/jira with config validation and retry/dead-letter semantics.
- 2026-02-21: Automated Node test coverage added for replay promotion gate evaluation and queue/decision ownership guard logic.
- 2026-02-21: Evidence Studio shipped in Flow Builder v2 with queue-scoped review decisions and drag-to-annotate evidence region capture.
- 2026-02-21: v2 review/evidence API integrity hardening shipped (queue-project consistency and decision-to-queue ownership checks).
- 2026-02-21: Legacy v1 API endpoints hardened with shared role/permission checks and stricter route-level validation.
- 2026-02-21: Replay v2 promotion gates shipped with configurable rollout thresholds (success rate, baseline-change rate, field accuracy, expected-sample coverage).
- 2026-02-21: Edge Control v2 expanded with runtime diagnostics UX (checkpoint visibility, filtered event stream, and one-click diagnostics command queueing).
- 2026-02-17: v2 control-plane API foundations added for projects, auth, flows, runs, datasets, replay, reviews, active-learning eval packs, connectors, and edge agent ingress.
- 2026-02-17: Flow Builder v2 UI shipped with graph editing, version/deploy controls, and webhook runtime testing.
- 2026-02-17: Replay v2 enhanced with optional baseline version diff summaries and field-level expected accuracy.
- 2026-02-17: Flow Builder v2 expanded with members/API keys, dataset versioning controls, and replay trigger UX.
- 2026-02-17: Connector delivery reliability shipped (idempotency, retry attempts, dead-letter records).
- 2026-02-17: Edge control channel APIs shipped (config versioning + command enqueue/pull/ack).
- 2026-02-17: Edge Control v2 UI shipped for agent registration, config updates, and command lifecycle operations.

## Risks And Blockers
- Scope growth across "general-purpose CV" surfaces.
- Need to keep v1 compatibility while accelerating v2 rollout.
- Need async delivery queue + backpressure controls for high-throughput connector dispatch.
