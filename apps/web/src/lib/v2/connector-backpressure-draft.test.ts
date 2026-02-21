import assert from "node:assert/strict";
import test from "node:test";

import { computeConnectorBackpressureDraftReadiness } from "./connector-backpressure-draft.ts";

test("computeConnectorBackpressureDraftReadiness counts actor as implicit approval when missing", () => {
  const readiness = computeConnectorBackpressureDraftReadiness({
    draft: {
      required_approvals: 2,
      approvals: [{ actor: "owner@flowstate.dev", approved_at: "2026-02-21T12:00:00.000Z" }],
      activate_at: null,
    },
    actor: "admin@flowstate.dev",
    nowMs: Date.parse("2026-02-21T12:30:00.000Z"),
  });

  assert.equal(readiness.approval_count, 2);
  assert.equal(readiness.approvals_remaining, 0);
  assert.equal(readiness.actor_counted, true);
  assert.equal(readiness.ready, true);
});

test("computeConnectorBackpressureDraftReadiness blocks before activation time", () => {
  const readiness = computeConnectorBackpressureDraftReadiness({
    draft: {
      required_approvals: 1,
      approvals: [{ actor: "owner@flowstate.dev", approved_at: "2026-02-21T12:00:00.000Z" }],
      activate_at: "2026-02-21T13:00:00.000Z",
    },
    actor: "owner@flowstate.dev",
    nowMs: Date.parse("2026-02-21T12:30:00.000Z"),
  });

  assert.equal(readiness.approvals_remaining, 0);
  assert.equal(readiness.activation_ready, false);
  assert.equal(readiness.ready, false);
});
