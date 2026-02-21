import assert from "node:assert/strict";
import test from "node:test";

import { evaluateConnectorBackpressureDraftActivation } from "./connector-backpressure-draft-activation.ts";

test("evaluateConnectorBackpressureDraftActivation returns ready when approvals/time gates are met", () => {
  const decision = evaluateConnectorBackpressureDraftActivation({
    draft: {
      required_approvals: 2,
      approvals: [
        { actor: "owner@flowstate.dev", approved_at: "2026-02-21T12:00:00.000Z" },
        { actor: "admin@flowstate.dev", approved_at: "2026-02-21T12:05:00.000Z" },
      ],
      activate_at: "2026-02-21T12:10:00.000Z",
    },
    nowMs: Date.parse("2026-02-21T12:11:00.000Z"),
  });

  assert.equal(decision.ready, true);
  assert.equal(decision.reason, null);
  assert.equal(decision.approvals_remaining, 0);
  assert.equal(decision.activation_ready, true);
});

test("evaluateConnectorBackpressureDraftActivation blocks when approval threshold is not met", () => {
  const decision = evaluateConnectorBackpressureDraftActivation({
    draft: {
      required_approvals: 3,
      approvals: [{ actor: "owner@flowstate.dev", approved_at: "2026-02-21T12:00:00.000Z" }],
      activate_at: null,
    },
    nowMs: Date.parse("2026-02-21T12:11:00.000Z"),
  });

  assert.equal(decision.ready, false);
  assert.equal(decision.reason, "approvals_pending");
  assert.equal(decision.approval_count, 1);
  assert.equal(decision.approvals_remaining, 2);
});

test("evaluateConnectorBackpressureDraftActivation blocks on activation time before approval check", () => {
  const decision = evaluateConnectorBackpressureDraftActivation({
    draft: {
      required_approvals: 1,
      approvals: [],
      activate_at: "2026-02-21T13:00:00.000Z",
    },
    nowMs: Date.parse("2026-02-21T12:59:00.000Z"),
  });

  assert.equal(decision.ready, false);
  assert.equal(decision.reason, "activation_time_pending");
  assert.equal(decision.activation_ready, false);
});
