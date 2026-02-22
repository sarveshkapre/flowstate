# Local-Only Auto-Annotation Studio (MVP)

## Product

Single-user local web app:
- import image/video assets
- auto-annotate with OpenAI vision
- review/edit labels
- apply natural-language bulk label ops
- export COCO/YOLO snapshots

No auth, no cloud storage, no hosted multi-tenant service.

## Goals

1. Fast labeling loop with strong auto-label + correction speed.
2. Natural-language bulk label operations with diff preview before apply.
3. Clean exports compatible with standard CV tooling.
4. Full local persistence on laptop (files + local DB state).

## Non-Goals (MVP)

1. Multi-user collaboration.
2. Custom model training/deployment.
3. Cloud buckets/storage integrations.
4. Billing/auth/account features.

## Core Workflow

1. Create/open local project.
2. Import images/videos.
3. Auto-annotate selected or full set.
4. Review/edit in labeling UI.
5. Run label ops with preview and confirm.
6. Export immutable COCO snapshots (YOLO follows in v0.2).

## Local Storage Contract

Each project workspace stores:
- `project.json`
- `images/`
- `annotations/`
- `exports/`

Project metadata and runtime state continue in the local DB.

## MVP Acceptance Criteria

1. Import 100 images, auto-label, review subset, export COCO successfully.
2. Label ops are preview-first and apply only after explicit confirm.
3. Reopening app restores project state locally.
4. Local-only execution works from fresh clone with OpenAI key configured.
