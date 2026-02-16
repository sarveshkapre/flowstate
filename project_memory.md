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

## Decisions

- OpenAI APIs only for model capabilities.
- Monorepo architecture from day one.
- Prioritize extraction + review workflows before broader CV parity.
