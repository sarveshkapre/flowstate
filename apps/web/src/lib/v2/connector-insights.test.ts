import assert from "node:assert/strict";
import test from "node:test";

import { computeConnectorInsights } from "./connector-insights.ts";

test("computeConnectorInsights summarizes delivery and attempt health within lookback window", () => {
  const insights = computeConnectorInsights({
    nowMs: Date.parse("2026-02-21T12:00:00.000Z"),
    lookbackHours: 24,
    deliveries: [
      {
        id: "d1",
        status: "delivered",
        attempt_count: 1,
        last_error: null,
        created_at: "2026-02-21T10:00:00.000Z",
        updated_at: "2026-02-21T10:01:00.000Z",
      },
      {
        id: "d2",
        status: "dead_lettered",
        attempt_count: 3,
        last_error: "timeout",
        created_at: "2026-02-21T08:00:00.000Z",
        updated_at: "2026-02-21T09:00:00.000Z",
      },
      {
        id: "d3",
        status: "retrying",
        attempt_count: 2,
        last_error: "timeout",
        created_at: "2026-02-21T06:00:00.000Z",
        updated_at: "2026-02-21T11:30:00.000Z",
      },
      {
        id: "d-old",
        status: "delivered",
        attempt_count: 1,
        last_error: null,
        created_at: "2026-02-19T06:00:00.000Z",
        updated_at: "2026-02-19T06:00:00.000Z",
      },
    ],
    attemptsByDeliveryId: {
      d1: [{ success: true, error_message: null, created_at: "2026-02-21T10:01:00.000Z" }],
      d2: [
        { success: false, error_message: "timeout", created_at: "2026-02-21T08:10:00.000Z" },
        { success: false, error_message: "timeout", created_at: "2026-02-21T08:20:00.000Z" },
        { success: false, error_message: "bad request", created_at: "2026-02-21T08:30:00.000Z" },
      ],
      d3: [{ success: false, error_message: "gateway error", created_at: "2026-02-21T11:31:00.000Z" }],
    },
  });

  assert.equal(insights.delivery_count, 3);
  assert.equal(insights.status_counts.delivered, 1);
  assert.equal(insights.status_counts.dead_lettered, 1);
  assert.equal(insights.status_counts.retrying, 1);
  assert.equal(insights.status_counts.queued, 0);
  assert.equal(insights.delivery_success_rate, 0.3333);
  assert.equal(insights.attempt_success_rate, 0.2);
  assert.equal(insights.avg_attempts_per_delivery, 2);
  assert.equal(insights.max_attempts_observed, 3);
  assert.deepEqual(insights.top_errors[0], { message: "timeout", count: 4 });
});

test("computeConnectorInsights handles empty delivery windows", () => {
  const insights = computeConnectorInsights({
    nowMs: Date.parse("2026-02-21T12:00:00.000Z"),
    lookbackHours: 1,
    deliveries: [],
    attemptsByDeliveryId: {},
  });

  assert.equal(insights.delivery_count, 0);
  assert.equal(insights.delivery_success_rate, 0);
  assert.equal(insights.attempt_success_rate, null);
  assert.equal(insights.avg_attempts_per_delivery, 0);
  assert.equal(insights.top_errors.length, 0);
});
