# Architecture Overview

## Services

- `apps/web`: Next.js UI + API gateway
- `apps/worker`: async job processor (queue-driven)
- `packages/types`: shared contracts and schemas
- `packages/ui`: shared UI primitives

## Data Flow (v1)

1. Client uploads artifact to web app.
2. Web API validates payload and enqueues extraction job.
3. Worker calls OpenAI API and returns structured output.
4. Web app stores result and exposes review tasks.

## Boundaries

- Web handles request/response and user interaction.
- Worker handles long-running tasks and retries.
- Shared packages enforce type-safe contracts.
