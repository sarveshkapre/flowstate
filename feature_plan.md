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
- [ ] Folder watcher ingestion (`~/Flowstate/inbox`)
- [ ] `launchd` service install/uninstall scripts
- [ ] Local backup/restore tooling
