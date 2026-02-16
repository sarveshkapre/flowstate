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

## Code Quality

- TypeScript strict mode remains enabled.
- Lint and typecheck must pass before merging.
- Any new API route must include basic validation and error handling.

## Product Direction Constraints

- Prioritize workflow automation, extraction, and review loops first.
- Do not attempt full CV model training/export parity in v1.
- Keep interfaces fast on laptops and mobile browsers.

## Security

- Never hardcode keys or secrets.
- Use environment variables with `.env.example` updates.
- Avoid logging raw sensitive user payloads.
