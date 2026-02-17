# Clone Context

Use this file as the first read in every new session for this repository.

## Goal
- Current goal: execute Milestone 1 and Milestone 2 foundations from the end-to-end SaaS-first plan.
- Why this matters now: unlock managed control-plane velocity while preserving local runtime paths.

## Expected Outcome
- What should be true after this session: `/api/v2/*` control-plane surfaces exist with tenant, role, and deployment primitives.
- Definition of done for this cycle: project/member/key auth scaffolding, flow version/deploy endpoints, run/dataset/replay/review stubs, edge ingress APIs, and profile/migration docs.

## Current State
- Completed recently: v1 wedge + workflow/eval/edge bundle/local runtime foundations.
- In progress: managed SaaS-first control plane under v2 namespace.
- Blockers or risks: broad scope can outpace reliability hardening without milestone gates.

## Immediate Next Actions
- [ ] Add edge agent control-plane UI for config edits and command dispatch/ack history.
- [ ] Add deterministic replay diff visualization UI (table + regressions).
- [ ] Add connector adapter implementations beyond simulated delivery mode.
- [ ] Add release gates that block deploys on replay regression thresholds.

## Constraints
- Guardrails: OpenAI-native runtime focus, additive migration strategy, v1 compatibility preserved.
- Non-goals: replacing v1 features with breaking changes in current cycle.

## Key References
- Roadmap: PRODUCT_ROADMAP.md
- Memory log: project_memory.md
- Incidents: INCIDENTS.md
- Agent contract: AGENTS.md

## Session Handoff
- Last updated: 2026-02-17T23:59:00Z
- Updated by: codex
- Notes for next session: continue Milestone 2 UI depth and start Milestone 3 diff visualization.
