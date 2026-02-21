import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewAlertIdempotencyKey,
  dispatchReviewAlertsOnce,
  parseReviewAlertsConfig,
  shouldDispatchReviewAlert,
} from "./review-alerts";

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("parseReviewAlertsConfig applies defaults", () => {
  const config = parseReviewAlertsConfig({});

  assert.equal(config.connectorType, "slack");
  assert.equal(config.pollMs, 60_000);
  assert.equal(config.staleHours, 24);
  assert.equal(config.queueLimit, 50);
  assert.equal(config.minUnreviewedQueues, 5);
  assert.equal(config.minAtRiskQueues, 3);
  assert.equal(config.minStaleQueues, 3);
  assert.equal(config.minAvgErrorRate, 0.35);
});

test("shouldDispatchReviewAlert triggers when thresholds are exceeded", () => {
  const byUnreviewed = shouldDispatchReviewAlert({
    summary: {
      total_queues: 8,
      unreviewed_queues: 6,
      at_risk_queues: 0,
      stale_queues: 0,
      healthy_queues: 2,
      total_decisions: 0,
      total_evidence_regions: 0,
      avg_error_rate: 0,
    },
    minUnreviewedQueues: 5,
    minAtRiskQueues: 3,
    minStaleQueues: 3,
    minAvgErrorRate: 0.5,
  });
  assert.equal(byUnreviewed, true);

  const byErrorRate = shouldDispatchReviewAlert({
    summary: {
      total_queues: 10,
      unreviewed_queues: 1,
      at_risk_queues: 1,
      stale_queues: 1,
      healthy_queues: 7,
      total_decisions: 20,
      total_evidence_regions: 5,
      avg_error_rate: 0.61,
    },
    minUnreviewedQueues: 5,
    minAtRiskQueues: 3,
    minStaleQueues: 3,
    minAvgErrorRate: 0.5,
  });
  assert.equal(byErrorRate, true);
});

test("buildReviewAlertIdempotencyKey is stable within same window and summary", () => {
  const first = buildReviewAlertIdempotencyKey({
    projectId: "proj_123",
    connectorType: "slack",
    nowMs: Date.parse("2026-02-21T12:01:00.000Z"),
    windowMinutes: 30,
    summary: {
      total_queues: 10,
      unreviewed_queues: 6,
      at_risk_queues: 2,
      stale_queues: 1,
      healthy_queues: 1,
      total_decisions: 50,
      total_evidence_regions: 25,
      avg_error_rate: 0.4,
    },
  });
  const second = buildReviewAlertIdempotencyKey({
    projectId: "proj_123",
    connectorType: "slack",
    nowMs: Date.parse("2026-02-21T12:20:00.000Z"),
    windowMinutes: 30,
    summary: {
      total_queues: 10,
      unreviewed_queues: 6,
      at_risk_queues: 2,
      stale_queues: 1,
      healthy_queues: 1,
      total_decisions: 50,
      total_evidence_regions: 25,
      avg_error_rate: 0.4,
    },
  });

  assert.equal(first, second);
});

test("dispatchReviewAlertsOnce dispatches connector alert when threshold is met", async () => {
  const seenRequests: Array<{ method?: string; url: string }> = [];
  const config = parseReviewAlertsConfig({
    FLOWSTATE_REVIEW_ALERTS_PROJECT_IDS: "proj-alpha",
    FLOWSTATE_REVIEW_ALERTS_CONNECTOR_TYPE: "webhook",
    FLOWSTATE_REVIEW_ALERTS_MIN_UNREVIEWED: "2",
    FLOWSTATE_REVIEW_ALERTS_MIN_AT_RISK: "2",
    FLOWSTATE_REVIEW_ALERTS_MIN_STALE: "2",
    FLOWSTATE_REVIEW_ALERTS_MIN_AVG_ERROR_RATE: "0.6",
  });

  const result = await dispatchReviewAlertsOnce({
    config,
    nowMs: Date.parse("2026-02-21T12:00:00.000Z"),
    fetchImpl: async (url, init) => {
      seenRequests.push({ method: init?.method, url: String(url) });

      if (String(url).includes("/api/v2/reviews/queues")) {
        return jsonResponse(200, {
          summary: {
            total_queues: 5,
            unreviewed_queues: 3,
            at_risk_queues: 1,
            stale_queues: 0,
            healthy_queues: 1,
            total_decisions: 12,
            total_evidence_regions: 6,
            avg_error_rate: 0.25,
          },
          queues: [{ run_id: "run_1", health: "unreviewed", error_rate: 0, non_correct_count: 0, decisions_total: 0 }],
        });
      }

      return jsonResponse(202, { delivery: { id: "delivery-id" } });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 1);
  assert.equal(result.evaluated_count, 1);
  assert.equal(result.alerted_count, 1);
  assert.equal(result.skipped_count, 0);
  assert.deepEqual(result.failures, []);
  assert.equal(seenRequests.length, 2);
  assert.ok(seenRequests[1]?.url.includes("/api/v2/connectors/webhook/deliver"));
});

test("dispatchReviewAlertsOnce skips connector call when thresholds are not met", async () => {
  const seenRequests: Array<{ method?: string; url: string }> = [];
  const config = parseReviewAlertsConfig({
    FLOWSTATE_REVIEW_ALERTS_PROJECT_IDS: "proj-alpha",
    FLOWSTATE_REVIEW_ALERTS_MIN_UNREVIEWED: "10",
    FLOWSTATE_REVIEW_ALERTS_MIN_AT_RISK: "10",
    FLOWSTATE_REVIEW_ALERTS_MIN_STALE: "10",
    FLOWSTATE_REVIEW_ALERTS_MIN_AVG_ERROR_RATE: "0.9",
  });

  const result = await dispatchReviewAlertsOnce({
    config,
    fetchImpl: async (url, init) => {
      seenRequests.push({ method: init?.method, url: String(url) });
      return jsonResponse(200, {
        summary: {
          total_queues: 5,
          unreviewed_queues: 1,
          at_risk_queues: 1,
          stale_queues: 1,
          healthy_queues: 2,
          total_decisions: 8,
          total_evidence_regions: 4,
          avg_error_rate: 0.2,
        },
        queues: [],
      });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 1);
  assert.equal(result.evaluated_count, 1);
  assert.equal(result.alerted_count, 0);
  assert.equal(result.skipped_count, 1);
  assert.deepEqual(result.failures, []);
  assert.equal(seenRequests.length, 1);
  assert.ok(seenRequests[0]?.url.includes("/api/v2/reviews/queues"));
});
