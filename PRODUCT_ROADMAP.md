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
- 2026-02-21: Connector backpressure tuning feedback loop shipped (typed tuning engine + recommend API + Flow Builder suggest/apply UX), turning live queue pressure into actionable threshold defaults per connector.
- 2026-02-21: Connector redrive automation now honors backpressure controls (API + worker + Flow Builder wiring), preventing redrive-triggered bursts from overrunning retry-heavy connector queues.
- 2026-02-21: Connector queue backpressure controls shipped across process APIs, Flow Builder controls, and worker pump defaults, adding adaptive throttling based on retry/due-now pressure for safer high-throughput dispatch.
- 2026-02-21: Connector Guardian dry-run controls shipped across env defaults, project policy API, Flow Builder policy UI, and worker execution, enabling shadow-mode rollout before live remediation.
- 2026-02-21: Flow Builder now supports reliability trend controls (enable/disable + baseline lookback window), allowing operators to tune regression detection sensitivity per project session.
- 2026-02-21: Reliability radar now includes trend intelligence (current vs prior window risk delta with improving/worsening labels), helping teams detect regressions earlier.
- 2026-02-21: Top recommendation preview UX now renders structured selected/skipped actions with reason labels and cooldown retry timing, reducing operator guesswork before execution.
- 2026-02-21: Top recommendations/radar now support scoped connector-type selection in Flow Builder, allowing safer staged remediation by integration instead of whole-project automation.
- 2026-02-21: Connector Recovery Radar now includes explainable risk scoring (reason codes + weighted breakdown drivers), improving operator trust and decision speed for automated remediation.
- 2026-02-21: Connector Automation Timeline filtering shipped (event-type and redrive-only filters in API + Flow Builder), enabling faster triage of specific remediation pathways.
- 2026-02-21: Top recommendation dry-run mode shipped with Flow Builder preview controls, allowing operators to inspect candidate connector actions and cooldown skips before executing remediation.
- 2026-02-21: Project-level Connector Guardian policy shipped (API + Flow Builder controls + worker policy resolution), enabling per-project automation guardrails for risk thresholds, action budgets, cooldowns, and remediation toggles.
- 2026-02-21: Local runtime orchestration now supports connector guardian lifecycle/logging in flowstate start/stop/status/logs scripts, making automated remediation manageable in day-to-day operations.
- 2026-02-21: Recommendation cooldown controls shipped across API/UI/worker, preventing repeated connector remediation thrash with configurable per-connector cooldown windows.
- 2026-02-21: Connector Guardian now executes per-project remediation through the unified top-recommendations endpoint, reducing worker API fan-out and aligning automation behavior with Flow Builder actions.
- 2026-02-21: Connector Automation Timeline shipped with a project-level action event API and Flow Builder visibility into queued/attempted/delivered/dead-lettered connector operations, including redrive/batch context.
- 2026-02-21: Top recommendation orchestration shipped with a project-level run endpoint and Flow Builder one-click execution of highest-risk connector actions using configurable risk/max-action controls.
- 2026-02-21: Connector Guardian automation shipped with worker-side risk-threshold polling that reads reliability rankings and executes top process/redrive recommendations per project.
- 2026-02-21: Connector recommendation runner shipped with a typed orchestration API and Flow Builder one-click execution of process/redrive actions directly from Recovery Radar rankings.
- 2026-02-21: Connector Recovery Radar shipped with a project-level reliability ranking API and Flow Builder risk-ranked action panel to focus operations on the highest-risk connector first.
- 2026-02-21: Worker connector pump automation now uses the project-level bulk process endpoint, reducing API fan-out and improving throughput for multi-connector projects.
- 2026-02-21: Project-level connector redrive orchestration shipped with a bulk redrive API, Flow Builder one-click all-connector recovery, and worker automation upgraded to single-call dead-letter recovery with processing.
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
- Need persisted per-project backpressure policies so tuned thresholds survive across operators and sessions.
