# AGENTS Guide for Flowstate

## Mission

Build Flowstate into an OpenAI-native VisionOps platform with production software quality.

## Non-Negotiables

- Use OpenAI APIs for model and agent features.
- Keep changes small, typed, and testable.
- Prefer clear, maintainable code over clever code.
- Avoid introducing unnecessary dependencies.

## Repository Conventions

- Monorepo with apps in `apps/*` and shared libs in `packages/*`.
- Domain types and schemas belong in `packages/types`.
- Reusable UI belongs in `packages/ui`.
- Worker jobs belong in `apps/worker/src/jobs`.

## UI Stack (Required)

- Default UI stack is shadcn/ui patterns on Tailwind CSS v4 with Radix UI primitives.
- Before building new UI, reference:
- `https://ui.shadcn.com/docs/tailwind-v4`
- `https://ui.shadcn.com/docs/components-json`
- `https://www.radix-ui.com/primitives/docs/overview/introduction`
- Local shadcn reference checkout at `/Users/sarvesh/code/ui` (alias: `/code/ui`) is the canonical source for primitive implementations.
- In `apps/web`, import `@shadcn-ui/*` and `@shadcn-lib/*` wrappers that are intentionally implemented as direct source imports from `/code/ui`.
- Do not introduce custom visual primitives for controls; use the shared wrappers first, with fallback to custom styling only for layout/page composition.

## Code Quality

- TypeScript strict mode remains enabled.
- Lint and typecheck must pass before merging.
- Any new API route must include basic validation and error handling.

## Product Direction Constraints

- Prioritize workflow automation, extraction, and review loops first.
- Do not attempt full CV model training/export parity in v1.
- Keep interfaces fast on laptops and mobile browsers.
- Default product scope is local-only single-user operation (no auth walls, no hosted cloud dependencies in MVP).

## Security

- Never hardcode keys or secrets.
- Use environment variables with `.env.example` updates.
- Avoid logging raw sensitive user payloads.
