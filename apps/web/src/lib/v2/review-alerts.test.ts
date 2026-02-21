import assert from "node:assert/strict";
import test from "node:test";

import { evaluateReviewAlert, normalizeReviewAlertThresholds } from "./review-alerts.ts";

test("normalizeReviewAlertThresholds clamps and normalizes values", () => {
  const normalized = normalizeReviewAlertThresholds({
    minUnreviewedQueues: -1,
    minAtRiskQueues: 3.8,
    minStaleQueues: Number.NaN,
    minAvgErrorRate: 1.7,
  });

  assert.deepEqual(normalized, {
    minUnreviewedQueues: 0,
    minAtRiskQueues: 3,
    minStaleQueues: 0,
    minAvgErrorRate: 1,
  });
});

test("evaluateReviewAlert returns reasons when thresholds are met", () => {
  const evaluation = evaluateReviewAlert({
    summary: {
      unreviewed_queues: 6,
      at_risk_queues: 4,
      stale_queues: 2,
      avg_error_rate: 0.42,
    },
    thresholds: {
      minUnreviewedQueues: 5,
      minAtRiskQueues: 3,
      minStaleQueues: 3,
      minAvgErrorRate: 0.4,
    },
  });

  assert.equal(evaluation.should_alert, true);
  assert.deepEqual(evaluation.reasons, [
    "unreviewed_queues >= 5",
    "at_risk_queues >= 3",
    "avg_error_rate >= 0.4",
  ]);
});

test("evaluateReviewAlert returns no reasons when thresholds are not met", () => {
  const evaluation = evaluateReviewAlert({
    summary: {
      unreviewed_queues: 1,
      at_risk_queues: 1,
      stale_queues: 1,
      avg_error_rate: 0.1,
    },
    thresholds: {
      minUnreviewedQueues: 5,
      minAtRiskQueues: 3,
      minStaleQueues: 3,
      minAvgErrorRate: 0.4,
    },
  });

  assert.equal(evaluation.should_alert, false);
  assert.deepEqual(evaluation.reasons, []);
});
