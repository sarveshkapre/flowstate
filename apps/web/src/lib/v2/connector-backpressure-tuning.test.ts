import assert from "node:assert/strict";
import test from "node:test";

import { suggestConnectorBackpressureSettings } from "./connector-backpressure-tuning.ts";

test("suggestConnectorBackpressureSettings returns defaults for empty input", () => {
  const result = suggestConnectorBackpressureSettings({
    summaries: [],
  });

  assert.deepEqual(result.recommendation, {
    enabled: true,
    maxRetrying: 50,
    maxDueNow: 100,
    minLimit: 1,
  });
  assert.deepEqual(result.by_connector, []);
});

test("suggestConnectorBackpressureSettings marks high pressure connectors and tightens min limit", () => {
  const result = suggestConnectorBackpressureSettings({
    summaries: [
      {
        connectorType: "webhook",
        summary: {
          queued: 80,
          retrying: 70,
          due_now: 120,
        },
      },
    ],
  });

  assert.equal(result.by_connector.length, 1);
  assert.equal(result.by_connector[0]?.pressure_tier, "high");
  assert.equal(result.by_connector[0]?.recommendation.minLimit, 1);
  assert.ok((result.by_connector[0]?.recommendation.maxRetrying ?? 0) >= 140);
  assert.ok((result.by_connector[0]?.recommendation.maxDueNow ?? 0) >= 240);
  assert.equal(result.recommendation.minLimit, 1);
});

test("suggestConnectorBackpressureSettings uses medium tier for moderate pressure", () => {
  const result = suggestConnectorBackpressureSettings({
    summaries: [
      {
        connectorType: "jira",
        summary: {
          queued: 40,
          retrying: 22,
          due_now: 30,
        },
      },
    ],
  });

  assert.equal(result.by_connector[0]?.pressure_tier, "medium");
  assert.equal(result.by_connector[0]?.recommendation.minLimit, 2);
});

test("suggestConnectorBackpressureSettings aggregates conservatively across connectors", () => {
  const result = suggestConnectorBackpressureSettings({
    summaries: [
      {
        connectorType: "slack",
        summary: {
          queued: 20,
          retrying: 5,
          due_now: 10,
        },
      },
      {
        connectorType: "sqs",
        summary: {
          queued: 90,
          retrying: 30,
          due_now: 70,
        },
      },
    ],
  });

  assert.equal(result.by_connector[0]?.connector_type, "sqs");
  assert.equal(result.by_connector[0]?.pressure_tier, "medium");
  assert.equal(result.recommendation.minLimit, 2);
  assert.ok(result.recommendation.maxRetrying >= 60);
  assert.ok(result.recommendation.maxDueNow >= 140);
});
