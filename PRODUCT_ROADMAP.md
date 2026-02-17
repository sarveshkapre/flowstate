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
- M1 SaaS Control Plane Foundations (in progress)

## Pending Features
- Role/permission hardening across all legacy v1 endpoints.
- UI for v2 project/member/key management.
- Flow graph editor and reusable templates.
- Replay diff reports and promotion gates.
- Evidence-region visual annotation UX.

## Delivered Features
- 2026-02-17: v2 control-plane API foundations added for projects, auth, flows, runs, datasets, replay, reviews, active-learning eval packs, connectors, and edge agent ingress.
- 2026-02-17: Flow Builder v2 UI shipped with graph editing, version/deploy controls, and webhook runtime testing.
- 2026-02-17: Replay v2 enhanced with optional baseline version diff summaries and field-level expected accuracy.

## Risks And Blockers
- Scope growth across "general-purpose CV" surfaces.
- Need to keep v1 compatibility while accelerating v2 rollout.
- Connector reliability and idempotency strategy requires deeper production hardening.
