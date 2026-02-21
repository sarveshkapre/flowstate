import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectorDeliveryRecord } from "@flowstate/types";

import { summarizeConnectorBackpressureOutcomes, toConnectorBackpressurePolicyUpdate } from "./connector-backpressure-insights.ts";

test("summarizeConnectorBackpressureOutcomes computes current vs baseline deltas", () => {
  const nowMs = Date.parse("2026-02-21T12:00:00.000Z");
  const deliveries: ConnectorDeliveryRecord[] = [
    {
      id: "delivered-current",
      project_id: "proj_1",
      connector_type: "webhook",
      idempotency_key: null,
      payload_hash: "hash_1",
      status: "delivered",
      attempt_count: 1,
      max_attempts: 3,
      last_status_code: 200,
      last_error: null,
      next_attempt_at: null,
      dead_letter_reason: null,
      delivered_at: "2026-02-21T11:00:00.000Z",
      created_at: "2026-02-21T10:59:00.000Z",
      updated_at: "2026-02-21T11:00:00.000Z",
    },
    {
      id: "dead-current",
      project_id: "proj_1",
      connector_type: "jira",
      idempotency_key: null,
      payload_hash: "hash_2",
      status: "dead_lettered",
      attempt_count: 3,
      max_attempts: 3,
      last_status_code: 500,
      last_error: "timeout",
      next_attempt_at: null,
      dead_letter_reason: "timeout",
      delivered_at: null,
      created_at: "2026-02-21T09:00:00.000Z",
      updated_at: "2026-02-21T09:30:00.000Z",
    },
    {
      id: "delivered-baseline",
      project_id: "proj_1",
      connector_type: "sqs",
      idempotency_key: null,
      payload_hash: "hash_3",
      status: "delivered",
      attempt_count: 1,
      max_attempts: 3,
      last_status_code: 200,
      last_error: null,
      next_attempt_at: null,
      dead_letter_reason: null,
      delivered_at: "2026-02-20T23:00:00.000Z",
      created_at: "2026-02-20T22:50:00.000Z",
      updated_at: "2026-02-20T23:00:00.000Z",
    },
  ];

  const trend = summarizeConnectorBackpressureOutcomes({
    deliveries,
    lookbackHours: 12,
    nowMs,
  });

  assert.equal(trend.current.total_deliveries, 2);
  assert.equal(trend.current.delivered, 1);
  assert.equal(trend.current.dead_lettered, 1);
  assert.equal(trend.baseline.total_deliveries, 1);
  assert.equal(trend.baseline.delivered, 1);
  assert.equal(trend.delta.total_deliveries, 1);
  assert.equal(trend.delta.dead_lettered, 1);
  assert.equal(trend.delta.delivery_success_rate, -0.5);
  assert.equal(trend.delta.dead_letter_rate, 0.5);
});

test("toConnectorBackpressurePolicyUpdate maps policy metadata from audit events", () => {
  const mapped = toConnectorBackpressurePolicyUpdate({
    id: "evt_1",
    job_id: null,
    event_type: "connector_backpressure_policy_updated_v2",
    actor: "ops@flowstate.dev",
    metadata: {
      project_id: "proj_1",
      is_enabled: false,
      max_retrying: 75,
      max_due_now: 150,
      min_limit: 3,
      connector_override_count: 2,
    },
    created_at: "2026-02-21T12:00:00.000Z",
  });

  assert.ok(mapped);
  assert.equal(mapped?.actor, "ops@flowstate.dev");
  assert.equal(mapped?.is_enabled, false);
  assert.equal(mapped?.max_retrying, 75);
  assert.equal(mapped?.max_due_now, 150);
  assert.equal(mapped?.min_limit, 3);
  assert.equal(mapped?.connector_override_count, 2);
});
