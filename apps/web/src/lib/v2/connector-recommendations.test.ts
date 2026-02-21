import assert from "node:assert/strict";
import test from "node:test";

import { selectConnectorRecommendationActions } from "./connector-recommendations.ts";

test("selectConnectorRecommendationActions picks high-risk non-healthy recommendations", () => {
  const selected = selectConnectorRecommendationActions({
    connectors: [
      {
        connector_type: "slack",
        risk_score: 12,
        recommendation: "process_queue",
        summary: { total: 1, queued: 1, retrying: 0, delivered: 0, dead_lettered: 0, due_now: 1, earliest_next_attempt_at: null },
        insights: {
          window_start: "",
          delivery_count: 1,
          status_counts: { queued: 1, retrying: 0, delivered: 0, dead_lettered: 0 },
          delivery_success_rate: 0,
          attempt_success_rate: null,
          avg_attempts_per_delivery: 0,
          max_attempts_observed: 0,
          top_errors: [],
        },
      },
      {
        connector_type: "jira",
        risk_score: 40,
        recommendation: "redrive_dead_letters",
        summary: { total: 3, queued: 0, retrying: 1, delivered: 1, dead_lettered: 1, due_now: 1, earliest_next_attempt_at: null },
        insights: {
          window_start: "",
          delivery_count: 3,
          status_counts: { queued: 0, retrying: 1, delivered: 1, dead_lettered: 1 },
          delivery_success_rate: 0.3333,
          attempt_success_rate: 0.5,
          avg_attempts_per_delivery: 2,
          max_attempts_observed: 3,
          top_errors: [{ message: "timeout", count: 2 }],
        },
      },
      {
        connector_type: "webhook",
        risk_score: 50,
        recommendation: "healthy",
        summary: { total: 2, queued: 0, retrying: 0, delivered: 2, dead_lettered: 0, due_now: 0, earliest_next_attempt_at: null },
        insights: {
          window_start: "",
          delivery_count: 2,
          status_counts: { queued: 0, retrying: 0, delivered: 2, dead_lettered: 0 },
          delivery_success_rate: 1,
          attempt_success_rate: 1,
          avg_attempts_per_delivery: 1,
          max_attempts_observed: 1,
          top_errors: [],
        },
      },
    ],
    riskThreshold: 10,
    maxActions: 5,
    allowProcessQueue: true,
    allowRedriveDeadLetters: true,
  });

  assert.equal(selected.length, 2);
  assert.equal(selected[0]?.connector_type, "jira");
  assert.equal(selected[0]?.recommendation, "redrive_dead_letters");
  assert.equal(selected[1]?.connector_type, "slack");
  assert.equal(selected[1]?.recommendation, "process_queue");
});

test("selectConnectorRecommendationActions respects flags, threshold, and max actions", () => {
  const selected = selectConnectorRecommendationActions({
    connectors: [
      {
        connector_type: "jira",
        risk_score: 35,
        recommendation: "redrive_dead_letters",
        summary: { total: 2, queued: 0, retrying: 1, delivered: 1, dead_lettered: 0, due_now: 1, earliest_next_attempt_at: null },
        insights: {
          window_start: "",
          delivery_count: 2,
          status_counts: { queued: 0, retrying: 1, delivered: 1, dead_lettered: 0 },
          delivery_success_rate: 0.5,
          attempt_success_rate: 0.5,
          avg_attempts_per_delivery: 2,
          max_attempts_observed: 3,
          top_errors: [],
        },
      },
      {
        connector_type: "slack",
        risk_score: 30,
        recommendation: "process_queue",
        summary: { total: 2, queued: 1, retrying: 0, delivered: 1, dead_lettered: 0, due_now: 1, earliest_next_attempt_at: null },
        insights: {
          window_start: "",
          delivery_count: 2,
          status_counts: { queued: 1, retrying: 0, delivered: 1, dead_lettered: 0 },
          delivery_success_rate: 0.5,
          attempt_success_rate: 1,
          avg_attempts_per_delivery: 1,
          max_attempts_observed: 1,
          top_errors: [],
        },
      },
      {
        connector_type: "webhook",
        risk_score: 25,
        recommendation: "process_queue",
        summary: { total: 2, queued: 1, retrying: 0, delivered: 1, dead_lettered: 0, due_now: 1, earliest_next_attempt_at: null },
        insights: {
          window_start: "",
          delivery_count: 2,
          status_counts: { queued: 1, retrying: 0, delivered: 1, dead_lettered: 0 },
          delivery_success_rate: 0.5,
          attempt_success_rate: 1,
          avg_attempts_per_delivery: 1,
          max_attempts_observed: 1,
          top_errors: [],
        },
      },
    ],
    riskThreshold: 20,
    maxActions: 1,
    allowProcessQueue: false,
    allowRedriveDeadLetters: true,
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.connector_type, "jira");
  assert.equal(selected[0]?.recommendation, "redrive_dead_letters");
});
