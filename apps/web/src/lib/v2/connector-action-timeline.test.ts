import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeConnectorActionTimeline,
  toConnectorActionTimelineEvent,
  type ConnectorActionTimelineEvent,
} from "./connector-action-timeline.ts";

test("toConnectorActionTimelineEvent maps metadata and falls back to derived context", () => {
  const mapped = toConnectorActionTimelineEvent({
    event: {
      id: "evt_1",
      job_id: null,
      event_type: "connector_delivery_attempted_v2",
      actor: "ops@flowstate.dev",
      metadata: {
        delivery_id: "del_1",
        attempt_number: 2,
        success: false,
        status_code: 429,
      },
      created_at: "2026-02-21T12:00:00.000Z",
    },
    fallback: {
      project_id: "proj_1",
      connector_type: "slack",
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.event_type, "connector_delivery_attempted_v2");
  assert.equal(mapped?.project_id, "proj_1");
  assert.equal(mapped?.connector_type, "slack");
  assert.equal(mapped?.delivery_id, "del_1");
  assert.equal(mapped?.attempt_number, 2);
  assert.equal(mapped?.status_code, 429);
});

test("summarizeConnectorActionTimeline aggregates event counts and connector breakdown", () => {
  const events: ConnectorActionTimelineEvent[] = [
    {
      id: "evt_1",
      event_type: "connector_delivery_queued_v2",
      actor: null,
      created_at: "2026-02-21T12:00:00.000Z",
      connector_type: "webhook",
      project_id: "proj_1",
      delivery_id: "del_1",
      attempt_number: null,
      success: null,
      status_code: null,
      reason: null,
      redrive: false,
      batch: false,
    },
    {
      id: "evt_2",
      event_type: "connector_delivery_queued_v2",
      actor: null,
      created_at: "2026-02-21T12:01:00.000Z",
      connector_type: "webhook",
      project_id: "proj_1",
      delivery_id: "del_2",
      attempt_number: null,
      success: null,
      status_code: null,
      reason: null,
      redrive: true,
      batch: true,
    },
    {
      id: "evt_3",
      event_type: "connector_delivered_v2",
      actor: "ops@flowstate.dev",
      created_at: "2026-02-21T12:02:00.000Z",
      connector_type: "webhook",
      project_id: "proj_1",
      delivery_id: "del_1",
      attempt_number: null,
      success: null,
      status_code: null,
      reason: null,
      redrive: false,
      batch: false,
    },
    {
      id: "evt_4",
      event_type: "connector_dead_lettered_v2",
      actor: "ops@flowstate.dev",
      created_at: "2026-02-21T12:03:00.000Z",
      connector_type: "jira",
      project_id: "proj_1",
      delivery_id: "del_3",
      attempt_number: null,
      success: null,
      status_code: null,
      reason: "timeout",
      redrive: false,
      batch: false,
    },
  ];

  const summary = summarizeConnectorActionTimeline(events);
  assert.equal(summary.total, 4);
  assert.equal(summary.queued, 2);
  assert.equal(summary.delivered, 1);
  assert.equal(summary.dead_lettered, 1);
  assert.equal(summary.redrive_queued, 1);
  assert.equal(summary.by_connector.length, 2);
  assert.equal(summary.by_connector[0]?.connector_type, "webhook");
  assert.equal(summary.by_connector[0]?.total, 3);
});
