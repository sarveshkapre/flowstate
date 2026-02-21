import assert from "node:assert/strict";
import test from "node:test";

import { resolveConnectorProcessBackpressure } from "./connector-backpressure.ts";

test("resolveConnectorProcessBackpressure returns requested limit when disabled", () => {
  const result = resolveConnectorProcessBackpressure({
    requestedLimit: 12,
    summary: {
      queued: 4,
      retrying: 20,
      due_now: 20,
    },
    config: {
      enabled: false,
    },
  });

  assert.equal(result.throttled, false);
  assert.equal(result.reason, null);
  assert.equal(result.requested_limit, 12);
  assert.equal(result.effective_limit, 12);
  assert.equal(result.summary.outstanding, 24);
});

test("resolveConnectorProcessBackpressure throttles when retrying queue hits threshold", () => {
  const result = resolveConnectorProcessBackpressure({
    requestedLimit: 20,
    summary: {
      queued: 2,
      retrying: 9,
      due_now: 3,
    },
    config: {
      enabled: true,
      maxRetrying: 8,
      minLimit: 4,
    },
  });

  assert.equal(result.throttled, true);
  assert.equal(result.reason, "retrying_limit");
  assert.equal(result.effective_limit, 4);
});

test("resolveConnectorProcessBackpressure throttles when due-now queue hits threshold", () => {
  const result = resolveConnectorProcessBackpressure({
    requestedLimit: 15,
    summary: {
      queued: 10,
      retrying: 2,
      due_now: 25,
    },
    config: {
      enabled: true,
      maxRetrying: 100,
      maxDueNow: 20,
      minLimit: 3,
    },
  });

  assert.equal(result.throttled, true);
  assert.equal(result.reason, "due_now_limit");
  assert.equal(result.effective_limit, 3);
});

test("resolveConnectorProcessBackpressure clamps invalid values and keeps safe defaults", () => {
  const result = resolveConnectorProcessBackpressure({
    requestedLimit: 0,
    summary: {
      queued: -1,
      retrying: 0,
      due_now: 0,
    },
    config: {
      enabled: true,
      maxRetrying: -5,
      maxDueNow: 0,
      minLimit: 1000,
    },
  });

  assert.equal(result.requested_limit, 10);
  assert.equal(result.throttled, false);
  assert.equal(result.effective_limit, 10);
  assert.equal(result.summary.queued, 0);
  assert.equal(result.thresholds.max_retrying, 50);
  assert.equal(result.thresholds.max_due_now, 100);
  assert.equal(result.thresholds.min_limit, 10);
});
