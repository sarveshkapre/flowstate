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
- Additional production connector integrations (SQS/DB) and async worker-backed delivery queues.
- Expand automated test coverage across worker/jobs and v1 extraction/review APIs.

## Delivered Features
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
