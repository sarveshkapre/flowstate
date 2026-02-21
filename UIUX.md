# UI/UX Guidelines for Flowstate

This file defines the default UI standards for any new or updated interface in Flowstate.

## 0. Source of Truth

1. Build UI using shadcn/ui Tailwind v4 patterns and Radix UI primitives.
2. Primary reference: `https://ui.shadcn.com/docs/tailwind-v4`
3. Primary reference: `https://www.radix-ui.com/primitives`
4. Local reference implementation: `/Users/sarvesh/code/ui`
5. Reusable UI primitives must be added in `packages/ui` first, then consumed by `apps/web`.

## 1. Product UX Priorities

1. Optimize for operator speed and confidence.
2. Keep the UI explainable under load and failure conditions.
3. Prefer fewer, clearer actions over feature-heavy screens.
4. Ship incremental polish without changing product behavior unless required.

## 2. Experience Principles

1. One primary task per surface.
2. Progressive disclosure for advanced controls.
3. Clear visual hierarchy before visual flair.
4. Dense information is acceptable only with strong grouping and scanability.
5. Every risky action must communicate impact and state.

## 3. Visual Language

### Typography

1. Primary: `Space Grotesk`.
2. Technical/data snippets: `IBM Plex Mono`.
3. Keep heading rhythm consistent:
- `h1`: screen purpose
- `h2`: major section
- `h3`: card/module
4. Avoid multiple decorative type treatments on one screen.

### Color

1. Neutrals first; accent color for actions and focus.
2. Use semantic status colors only for state (`success`, `warning`, `error`, `info`).
3. Do not encode important meaning with color alone.

### Surface + Depth

1. Use layered surfaces (`page`, `panel`, `card`) to organize complexity.
2. Subtle depth only; avoid heavy glow/shadow noise.
3. Preserve generous white space around high-risk controls.

## 4. Layout and Information Architecture

1. Keep page width readable; avoid edge-to-edge form walls on desktop.
2. Group related controls into sections with clear headings.
3. Use 2-column grids for related config, single column for workflows and logs.
4. Avoid giant undifferentiated action rows.
5. Put primary actions near the context they affect.

## 5. Component Behavior Standards

### Buttons

1. Exactly one primary action per local section.
2. Secondary actions should not visually compete with primary.
3. Disabled state must be visibly distinct and predictable.
4. All buttons must have hover, active, focus-visible states.

### Inputs

1. Every input needs a clear label.
2. Use helper text for non-obvious formats or limits.
3. Show inline validation near the field.
4. Preserve entered values on recoverable failures.

### Status/Feedback

1. Use concise status banners with explicit outcomes.
2. All async actions need loading feedback.
3. Distinguish transient info vs actionable errors.
4. Prefer user-facing plain language over internal jargon.

### Lists and Data Blocks

1. Use monospaced text only for IDs/technical payloads.
2. Long JSON output should be optional or collapsed where possible.
3. Provide summary first, details second.

## 6. Accessibility Baseline

1. Keyboard reachable for all core actions.
2. Visible focus ring on all interactive controls.
3. Semantic headings and labels for screen readers.
4. Adequate contrast for text, borders, states.
5. Avoid motion that blocks comprehension.

## 7. Motion and Interaction Quality

1. Motion is supportive, not ornamental.
2. Default transitions: 120-180ms for controls, 160-220ms for surface shifts.
3. Use movement to indicate relationship (hover lift, modal entry, state change).
4. Respect reduced-motion preferences when adding richer animation.

## 8. Mobile and Responsive Rules

1. Mobile supports monitoring, approvals, and quick actions.
2. Heavy configuration and dense editing remain desktop-first.
3. Ensure tap targets and spacing are comfortable on small screens.
4. Preserve reading hierarchy when stacking columns.

## 9. Flow Builder Specific Rules

1. Keep high-frequency actions immediately visible.
2. Separate "configure" from "execute" from "inspect" areas.
3. Do not add new controls to the top action row unless they are high-frequency.
4. Default advanced controls to collapsed or lower visual priority.
5. Show risk and readiness states clearly before irreversible actions.

## 10. Definition of Done for UI Changes

A UI task is complete only if:

1. It improves clarity, speed, or confidence for a real operator task.
2. It includes empty/loading/success/error states.
3. Keyboard and focus-visible behavior remain correct.
4. It works on desktop and mobile breakpoints.
5. It does not add unnecessary dependencies.
6. It passes lint/typecheck/build.

## 11. Anti-Patterns to Avoid

1. Shipping raw feature controls without hierarchy.
2. Overusing bright accents, heavy borders, or deep shadows.
3. Multiplying button variants without semantic need.
4. Mixing inconsistent spacing scales in one screen.
5. Adding UI complexity without reducing user decision cost.

## 12. Implementation Notes for Contributors

1. Use `@flowstate/ui` components as the first choice for buttons, inputs, cards, tabs, and badges.
2. When adding a new component, follow shadcn component structure and `cn` utility patterns.
3. Keep style tokens centralized in Tailwind v4 CSS variables and avoid page-scoped one-off color systems.
4. Prefer Radix-based behavior wrappers (accessibility/state) over custom JS for primitives.
5. If introducing a new pattern, document it in this file in the same PR.
