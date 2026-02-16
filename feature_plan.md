# Feature Plan

## Phase 0: Foundations (Done)

- [x] Monorepo scaffold
- [x] Shared types package
- [x] OpenAI integration baseline
- [x] Health + starter extraction endpoints

## Phase 1: Wedge Product (Done)

- [x] Upload pipeline (image/pdf)
- [x] Extraction schema templates (receipt, invoice)
- [x] Validation engine (totals, mandatory fields)
- [x] Human review queue UI
- [x] Export to CSV/webhook

## Phase 2: Team Workflow (Next)

- [ ] Role-based access
- [x] Reviewer assignment + audit logs
- [x] Dataset snapshot for reviewed examples
- [x] Confidence dashboard (drift view pending)

## Phase 3: Flowstate Parity Layer

- [x] Workflow builder foundation (API + UI)
- [x] Active learning loop foundation (candidates + snapshots)
- [x] Edge deployment adapters
- [x] Evaluation runs foundation (quality baseline metrics)
- [x] Multi-tenant org controls foundation (organizations + scoped modules)

## Phase 4: Local-First Mac Ops

- [x] One-command macOS setup script
- [x] Local dev service manager (up/down with logs + PID files)
- [x] Folder watcher ingestion (`~/Flowstate/inbox`)
- [ ] `launchd` service install/uninstall scripts
- [ ] Local backup/restore tooling

## Phase 5: Roboflow-Style Parity (Next Priority)

- [ ] 5.1 Flow Builder v1 (no-code pipelines)
Context: create a visual pipeline graph so developers can compose Source -> Transform -> Decision -> Sink without writing glue code.
Initial scope: source blocks (`upload`, `webhook`, `folder`, `rtsp`), processing blocks (extract, validate, dedupe, redact, classify, route, human-review), sink blocks (webhook, Slack, Jira, SQS, DB), deploy button that publishes a versioned endpoint per flow.
Acceptance signal: an operator can build and deploy one end-to-end pipeline from UI in under 5 minutes.

- [ ] 5.2 Dataset + Run Versioning v1
Context: make every flow run reproducible and regression-testable.
Initial scope: project-scoped datasets, immutable dataset snapshots (`vN`), flow versions (`vN`), run history with trace/cost/latency, replay action (`run flow version X on dataset version Y`), diff reports between runs.
Acceptance signal: team can compare two flow versions against the same dataset and get a deterministic delta report.

- [ ] 5.3 Structured Review/Label UI v1
Context: shift review from CV box-labeling to extraction outcomes and evidence quality.
Initial scope: field-level approve/reject, evidence highlight/region linking, failure taxonomy (missing field, incorrect arithmetic, hallucinated entity, wrong currency/date), reviewer shortcuts and batch triage.
Acceptance signal: reviewers can produce high-quality labeled feedback sets with at least 50% less effort than manual JSON editing.

- [ ] 5.4 Active Learning + Hard Example Mining v2
Context: prioritize limited human review on the highest-value failures.
Initial scope: candidate ranking using low confidence + schema violations + disagreement (when multi-model enabled) + business-impact weights, one-click conversion to eval packs and snapshot sets, feedback loop to update review queues.
Acceptance signal: top 1-5% routed samples drive measurable quality lift on eval metrics over subsequent runs.

- [ ] 5.5 Edge Runner Agent v1
Context: support near-camera/local processing for Mac mini, Jetson, and VM operators.
Initial scope: lightweight runtime that ingests RTSP/webcam streams, samples frames/documents, executes selected flow locally, buffers events when offline, syncs outputs when reconnected.
Acceptance signal: sustained local processing from RTSP input with recoverable buffering and no data loss across temporary disconnects.
