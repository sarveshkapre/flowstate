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

## Decisions

- OpenAI APIs only for model capabilities.
- Monorepo architecture from day one.
- Prioritize extraction + review workflows before broader CV parity.
