import assert from "node:assert/strict";
import test from "node:test";

import { parseConnectorRedriveConfig, runConnectorRedriveOnce } from "./connector-redrive";

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("parseConnectorRedriveConfig applies defaults", () => {
  const config = parseConnectorRedriveConfig({});

  assert.equal(config.apiBaseUrl, "http://localhost:3000");
  assert.deepEqual(config.connectorTypes, ["webhook", "slack", "jira", "sqs", "db"]);
  assert.equal(config.redriveLimit, 10);
  assert.equal(config.minDeadLetterCount, 3);
  assert.equal(config.minDeadLetterMinutes, 15);
  assert.equal(config.processAfterRedrive, true);
  assert.equal(config.useProjectBackpressurePolicy, true);
  assert.equal(config.backpressureEnabled, true);
  assert.equal(config.backpressureMaxRetrying, 50);
  assert.equal(config.backpressureMaxDueNow, 100);
  assert.equal(config.backpressureMinLimit, 1);
});

test("parseConnectorRedriveConfig normalizes custom values", () => {
  const config = parseConnectorRedriveConfig({
    FLOWSTATE_LOCAL_API_BASE: "http://localhost:3010/",
    FLOWSTATE_CONNECTOR_REDRIVE_TYPES: "Slack,webhook,slack",
    FLOWSTATE_CONNECTOR_REDRIVE_PROJECT_IDS: " p1, p2, p1 ",
    FLOWSTATE_CONNECTOR_REDRIVE_LIMIT: "999",
    FLOWSTATE_CONNECTOR_REDRIVE_MIN_DEAD_LETTER: "2",
    FLOWSTATE_CONNECTOR_REDRIVE_MIN_DEAD_LETTER_MINUTES: "0",
    FLOWSTATE_CONNECTOR_REDRIVE_PROCESS_AFTER_REDRIVE: "false",
    FLOWSTATE_CONNECTOR_REDRIVE_USE_PROJECT_BACKPRESSURE_POLICY: "0",
    FLOWSTATE_CONNECTOR_REDRIVE_BACKPRESSURE_ENABLED: "0",
    FLOWSTATE_CONNECTOR_REDRIVE_BACKPRESSURE_MAX_RETRYING: "999999",
    FLOWSTATE_CONNECTOR_REDRIVE_BACKPRESSURE_MAX_DUE_NOW: "250",
    FLOWSTATE_CONNECTOR_REDRIVE_BACKPRESSURE_MIN_LIMIT: "300",
  });

  assert.equal(config.apiBaseUrl, "http://localhost:3010");
  assert.deepEqual(config.connectorTypes, ["slack", "webhook"]);
  assert.deepEqual(config.projectIds, ["p1", "p2"]);
  assert.equal(config.redriveLimit, 100);
  assert.equal(config.minDeadLetterCount, 2);
  assert.equal(config.minDeadLetterMinutes, 15);
  assert.equal(config.processAfterRedrive, false);
  assert.equal(config.useProjectBackpressurePolicy, false);
  assert.equal(config.backpressureEnabled, false);
  assert.equal(config.backpressureMaxRetrying, 10_000);
  assert.equal(config.backpressureMaxDueNow, 250);
  assert.equal(config.backpressureMinLimit, 100);
});

test("parseConnectorRedriveConfig ignores unsupported connector types", () => {
  const config = parseConnectorRedriveConfig({
    FLOWSTATE_CONNECTOR_REDRIVE_TYPES: "sqs,unknown,db,custom",
  });

  assert.deepEqual(config.connectorTypes, ["sqs", "db"]);
});

test("runConnectorRedriveOnce skips when dead-letter threshold is not met", async () => {
  const seenRequests: Array<{ method?: string; url: string }> = [];
  const config = parseConnectorRedriveConfig({
    FLOWSTATE_CONNECTOR_REDRIVE_PROJECT_IDS: "proj-1",
    FLOWSTATE_CONNECTOR_REDRIVE_TYPES: "webhook",
    FLOWSTATE_CONNECTOR_REDRIVE_MIN_DEAD_LETTER: "5",
  });

  const result = await runConnectorRedriveOnce({
    config,
    fetchImpl: async (url, init) => {
      seenRequests.push({ method: init?.method, url: String(url) });
      return jsonResponse(200, {
        redriven_count: 0,
        processed_count: 0,
        skipped_count: 1,
      });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 1);
  assert.equal(result.connector_count, 1);
  assert.equal(result.redriven_count, 0);
  assert.equal(result.processed_count, 0);
  assert.equal(result.skipped_count, 1);
  assert.deepEqual(result.failures, []);
  assert.equal(seenRequests.length, 1);
  assert.equal(seenRequests[0]?.method, "POST");
  assert.ok(seenRequests[0]?.url.endsWith("/api/v2/connectors/redrive"));
});

test("runConnectorRedriveOnce redrives batch and processes queue", async () => {
  const seenRequests: Array<{ method?: string; url: string }> = [];
  const requestBodies: Array<Record<string, unknown>> = [];
  const config = parseConnectorRedriveConfig({
    FLOWSTATE_CONNECTOR_REDRIVE_PROJECT_IDS: "proj-1",
    FLOWSTATE_CONNECTOR_REDRIVE_TYPES: "webhook",
    FLOWSTATE_CONNECTOR_REDRIVE_MIN_DEAD_LETTER: "3",
    FLOWSTATE_CONNECTOR_REDRIVE_LIMIT: "4",
  });

  const result = await runConnectorRedriveOnce({
    config,
    fetchImpl: async (url, init) => {
      const request = { method: init?.method, url: String(url) };
      seenRequests.push(request);
      if (typeof init?.body === "string") {
        requestBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return jsonResponse(200, {
        per_connector: [{ connector_type: "webhook", redriven_count: 4, processed_count: 3, skipped: false }],
        skipped_count: 0,
        redriven_count: 4,
        processed_count: 3,
      });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.redriven_count, 4);
  assert.equal(result.processed_count, 3);
  assert.equal(result.skipped_count, 0);
  assert.deepEqual(result.failures, []);
  assert.equal(seenRequests.length, 1);
  assert.ok(seenRequests[0]?.url.endsWith("/api/v2/connectors/redrive"));
  assert.equal(requestBodies.length, 1);
  assert.equal(requestBodies[0]?.projectId, "proj-1");
  assert.deepEqual(requestBodies[0]?.connectorTypes, ["webhook"]);
  assert.equal(requestBodies[0]?.processAfterRedrive, true);
  assert.equal(requestBodies[0]?.backpressure, undefined);
});

test("runConnectorRedriveOnce sends explicit backpressure when project policy usage is disabled", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const config = parseConnectorRedriveConfig({
    FLOWSTATE_CONNECTOR_REDRIVE_PROJECT_IDS: "proj-1",
    FLOWSTATE_CONNECTOR_REDRIVE_TYPES: "webhook",
    FLOWSTATE_CONNECTOR_REDRIVE_USE_PROJECT_BACKPRESSURE_POLICY: "false",
  });

  await runConnectorRedriveOnce({
    config,
    fetchImpl: async (_url, init) => {
      if (typeof init?.body === "string") {
        requestBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return jsonResponse(200, {
        redriven_count: 0,
        processed_count: 0,
        skipped_count: 1,
      });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(requestBodies.length, 1);
  assert.deepEqual(requestBodies[0]?.backpressure, {
    enabled: true,
    maxRetrying: 50,
    maxDueNow: 100,
    minLimit: 1,
  });
});

test("runConnectorRedriveOnce continues after project-level failures", async () => {
  let call = 0;
  const config = parseConnectorRedriveConfig({
    FLOWSTATE_CONNECTOR_REDRIVE_PROJECT_IDS: "proj-1,proj-2",
    FLOWSTATE_CONNECTOR_REDRIVE_TYPES: "webhook,slack",
  });

  const result = await runConnectorRedriveOnce({
    config,
    fetchImpl: async (url) => {
      call += 1;
      if (call === 1) {
        return jsonResponse(500, { error: "bulk redrive unavailable" });
      }
      assert.ok(String(url).endsWith("/api/v2/connectors/redrive"));
      return jsonResponse(200, { redriven_count: 2, processed_count: 2, skipped_count: 0 });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.connector_count, 4);
  assert.equal(result.failures.length, 1);
  assert.ok(result.failures[0]?.includes("proj-1: failed to redrive connector queues"));
  assert.equal(result.redriven_count, 2);
  assert.equal(result.processed_count, 2);
});
