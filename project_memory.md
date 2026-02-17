# Project Memory

## 2026-02-16

- Repository scaffold created from scratch.
- Selected stack: Next.js + TypeScript + OpenAI SDK + worker service.
- Added foundational docs for product, UX, and agent behavior.

## 2026-02-16 (Phase 1 Delivery)

- Implemented persistent artifact + extraction job store in `.flowstate-data/`.
- Added upload API for image/pdf ingestion.
- Added extraction orchestration endpoint using OpenAI Responses API templates:
  - invoice extraction
  - receipt extraction
- Added validation engine with required field and arithmetic consistency checks.
- Added review queue actions (approve/reject) and frontend review UI.
- Added CSV export and webhook dispatch endpoints for approved jobs.

## 2026-02-16 (Phase 2 Foundations)

- Added reviewer assignment action (`PATCH /api/v1/extractions/:jobId` with `action=assign`).
- Added audit event stream for job lifecycle, review actions, and webhook deliveries.
- Added dataset snapshot endpoint that writes reviewed-job JSONL files.
- Added live metrics endpoint and dashboard cards for queue/quality visibility.

## 2026-02-16 (Workflow + Active Learning Foundations)

- Added workflow records + run records in persistent datastore.
- Added workflow APIs and workflow builder UI (`/workflows`).
- Implemented workflow execution orchestration (extract + optional auto-review + optional webhook).
- Added active learning candidate endpoint and active learning snapshot endpoint.
- Added drift insights endpoint and surfaced drift summary in dashboard metrics.

## 2026-02-16 (Edge Adapter Bundles)

- Added edge adapter catalog for:
  - cloudflare_worker
  - vercel_edge_function
  - browser_wasm
- Added edge bundle generation endpoint that compiles workflow + extraction manifest JSON.
- Added persistent edge bundle records and download endpoint for generated bundle files.
- Added `/edge` UI for bundle creation, manifest preview, and file download.

## 2026-02-16 (Evaluation Runs Foundations)

- Added eval run records with aggregate quality metrics:
  - avg confidence
  - avg field coverage
  - error/warning rates
- Added evaluation service for benchmark-style runs over reviewed extraction jobs.
- Added eval run API endpoints:
  - `GET /api/v1/evals/runs`
  - `POST /api/v1/evals/runs`
- Added `/evals` UI for creating runs and reviewing run history.

## 2026-02-16 (Multi-Tenant Foundations)

- Added organization data model and management endpoints:
  - `GET /api/v1/organizations`
  - `POST /api/v1/organizations`
- Added migration-safe default organization assignment for existing persisted records.
- Added organization scoping fields to:
  - workflows
  - workflow runs
  - edge deployment bundles
  - eval runs
- Updated workflow, edge, and eval UIs to select organization context.
- Added `/organizations` UI for tenant creation and visibility.

## 2026-02-16 (Local-First Mac Runtime)

- Added `scripts/setup-mac.sh` for macOS bootstrap:
  - checks Node/npm prerequisites
  - validates `.env` + `OPENAI_API_KEY`
  - installs dependencies
  - initializes runtime/data directories
- Added `scripts/dev-up.sh` and `scripts/dev-down.sh`:
  - starts/stops web + worker as background services
  - stores PID files and logs under `.flowstate-runtime/`
- Added `scripts/flowstate.sh` local runtime wrapper:
  - `start`, `stop`, `restart`, `status`, `logs`
  - mapped to npm commands (`npm start`, `npm stop`, `npm run flowstate -- <command>`)
- Updated local start behavior:
  - `npm start` auto-creates `.env` from `.env.example` when missing
  - accepts `OPENAI_API_KEY` from shell environment when `.env` key is empty
  - fixed macOS Bash 3.2 compatibility in watcher flag parsing
- Added inbox watcher worker (`apps/worker/src/watch/inbox.ts`) with:
  - auto-upload from `~/Flowstate/inbox`
  - workflow-triggered processing (or document-type fallback extraction)
  - retry + archive/error file routing
- Added optional watcher auto-start from `dev-up` via `FLOWSTATE_ENABLE_FOLDER_WATCHER=1`
- Added root npm scripts:
  - `setup:mac`
  - `dev:up`
  - `dev:down`
  - `watch:inbox`
- Updated README with local macOS deployment workflow.

## 2026-02-17 (Milestone 1 SaaS Control-Plane Foundations)

- Added v2 data contracts for projects, memberships, API keys, flow graph/version/deploy, datasets, run traces, review decisions/evidence, eval packs, and edge agent state.
- Added v2 persistence store (`db.v2.json`) and APIs for:
  - auth magic-link request/verify
  - project/member/API key management
  - flow create/version/deploy
  - webhook deployment execution + run traces
  - dataset versions + replay endpoint
  - review decisions/evidence capture
  - active-learning candidates + eval-pack creation
  - connector test/deliver scaffolding
  - edge agent register/heartbeat/events ingress
- Added role/permission enforcement for v2 endpoints with local-friendly optional auth mode and strict SaaS mode.
- Added profile and migration docs:
  - `docs/environment-profiles.md`
  - `docs/migrations.md`

## 2026-02-17 (Milestone 2 Kickoff: Flow Builder v2)

- Added new Flow Builder page at `/flow-builder` with:
  - local/strict auth headers support (API key or local actor identity)
  - organization/project/flow selection + creation actions
  - project member assignment and API key issuance actions
  - node/edge graph editor and template loader
  - graph validation rules before flow-version persistence
  - flow version save + deployment controls
  - webhook runtime test harness against deployment keys
  - dataset + dataset-version creation and replay execution controls
  - connector reliability lab (retry/dead-letter simulation + delivery history)
- Enhanced replay endpoint (`POST /api/v2/replay`) with:
  - optional baseline flow-version comparison
  - changed-field summaries versus baseline
  - expected-value field accuracy metrics when dataset lines include `expected` or `ground_truth`
- Added v2 connector delivery state model and APIs:
  - idempotency-aware delivery records
  - retry attempt records
  - dead-letter terminal status with reason tracking
- Added v2 edge control channel APIs:
  - agent config version records (`GET/POST /api/v2/edge/agents/:agentId/config`)
  - command queue (`GET/POST /api/v2/edge/agents/:agentId/commands`)
  - agent pull/ack loop (`POST /commands/pull`, `POST /commands/:commandId/ack`)
  - secured heartbeat/events with project permission checks
- Added `/edge-control` UI for:
  - project-scoped edge agent registration
  - config version write/read
  - command enqueue/pull/ack workflows
- Added global command palette navigation (`Cmd/Ctrl + K`) with page search and quick jump.
- Improved operator UX across control-plane screens:
  - action-level loading/disabled states
  - explicit status banners (info/success/error)
  - edge health badges and command status filtering

## Decisions

- OpenAI APIs only for model capabilities.
- Monorepo architecture from day one.
- Prioritize extraction + review workflows before broader CV parity.
