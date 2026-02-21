import assert from "node:assert/strict";
import test from "node:test";

import { rankConnectorReliability } from "./connector-reliability.ts";

test("rankConnectorReliability prioritizes dead-letter and retry pressure", () => {
  const ranked = rankConnectorReliability([
    {
      connector_type: "slack",
      summary: {
        total: 5,
        queued: 1,
        retrying: 0,
        delivered: 4,
        dead_lettered: 0,
        due_now: 1,
        earliest_next_attempt_at: null,
      },
      insights: {
        window_start: "2026-02-21T00:00:00.000Z",
        delivery_count: 5,
        status_counts: { queued: 1, retrying: 0, delivered: 4, dead_lettered: 0 },
        delivery_success_rate: 0.8,
        attempt_success_rate: 0.9,
        avg_attempts_per_delivery: 1.2,
        max_attempts_observed: 2,
        top_errors: [{ message: "429 rate limited", count: 1 }],
      },
    },
    {
      connector_type: "jira",
      summary: {
        total: 6,
        queued: 1,
        retrying: 2,
        delivered: 2,
        dead_lettered: 1,
        due_now: 2,
        earliest_next_attempt_at: "2026-02-21T12:00:00.000Z",
      },
      insights: {
        window_start: "2026-02-21T00:00:00.000Z",
        delivery_count: 6,
        status_counts: { queued: 1, retrying: 2, delivered: 2, dead_lettered: 1 },
        delivery_success_rate: 0.3333,
        attempt_success_rate: 0.5,
        avg_attempts_per_delivery: 2.2,
        max_attempts_observed: 4,
        top_errors: [{ message: "jira 500", count: 4 }],
      },
    },
  ]);

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]?.connector_type, "jira");
  assert.equal(ranked[0]?.recommendation, "redrive_dead_letters");
  assert.equal(ranked[1]?.recommendation, "process_queue");
  assert.ok((ranked[0]?.risk_score ?? 0) > (ranked[1]?.risk_score ?? 0));
});

test("rankConnectorReliability marks healthy connectors with no queue pressure", () => {
  const ranked = rankConnectorReliability([
    {
      connector_type: "webhook",
      summary: {
        total: 3,
        queued: 0,
        retrying: 0,
        delivered: 3,
        dead_lettered: 0,
        due_now: 0,
        earliest_next_attempt_at: null,
      },
      insights: {
        window_start: "2026-02-21T00:00:00.000Z",
        delivery_count: 3,
        status_counts: { queued: 0, retrying: 0, delivered: 3, dead_lettered: 0 },
        delivery_success_rate: 1,
        attempt_success_rate: 1,
        avg_attempts_per_delivery: 1,
        max_attempts_observed: 1,
        top_errors: [],
      },
    },
  ]);

  assert.equal(ranked[0]?.connector_type, "webhook");
  assert.equal(ranked[0]?.recommendation, "healthy");
});
