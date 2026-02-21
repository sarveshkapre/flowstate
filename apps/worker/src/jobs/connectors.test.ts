import assert from "node:assert/strict";
import test from "node:test";

import { parseConnectorPumpConfig, pumpConnectorQueuesOnce } from "./connectors";

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("parseConnectorPumpConfig applies defaults", () => {
  const config = parseConnectorPumpConfig({});

  assert.equal(config.apiBaseUrl, "http://localhost:3000");
  assert.deepEqual(config.connectorTypes, ["webhook", "slack", "jira", "sqs", "db"]);
  assert.equal(config.limit, 25);
  assert.equal(config.backpressureEnabled, true);
  assert.equal(config.backpressureMaxRetrying, 50);
  assert.equal(config.backpressureMaxDueNow, 100);
  assert.equal(config.backpressureMinLimit, 1);
  assert.equal(config.pollMs, 5000);
  assert.deepEqual(config.projectIds, []);
});

test("parseConnectorPumpConfig normalizes custom values and clamps limits", () => {
  const config = parseConnectorPumpConfig({
    FLOWSTATE_LOCAL_API_BASE: "http://localhost:3100/",
    FLOWSTATE_CONNECTOR_PUMP_TYPES: "Webhook, jira, webhook",
    FLOWSTATE_CONNECTOR_PUMP_LIMIT: "999",
    FLOWSTATE_CONNECTOR_PUMP_BACKPRESSURE_ENABLED: "false",
    FLOWSTATE_CONNECTOR_PUMP_BACKPRESSURE_MAX_RETRYING: "999999",
    FLOWSTATE_CONNECTOR_PUMP_BACKPRESSURE_MAX_DUE_NOW: "250",
    FLOWSTATE_CONNECTOR_PUMP_BACKPRESSURE_MIN_LIMIT: "300",
    FLOWSTATE_CONNECTOR_PUMP_POLL_MS: "0",
    FLOWSTATE_CONNECTOR_PUMP_PROJECT_IDS: " p1, p2 ,p1 ",
  });

  assert.equal(config.apiBaseUrl, "http://localhost:3100");
  assert.deepEqual(config.connectorTypes, ["webhook", "jira"]);
  assert.equal(config.limit, 100);
  assert.equal(config.backpressureEnabled, false);
  assert.equal(config.backpressureMaxRetrying, 10_000);
  assert.equal(config.backpressureMaxDueNow, 250);
  assert.equal(config.backpressureMinLimit, 100);
  assert.equal(config.pollMs, 5000);
  assert.deepEqual(config.projectIds, ["p1", "p2"]);
});

test("parseConnectorPumpConfig ignores unsupported connector types", () => {
  const config = parseConnectorPumpConfig({
    FLOWSTATE_CONNECTOR_PUMP_TYPES: "webhook,unknown,db,custom",
  });

  assert.deepEqual(config.connectorTypes, ["webhook", "db"]);
});

test("pumpConnectorQueuesOnce uses explicit project IDs without listing projects", async () => {
  const seenRequests: Array<{ method?: string; url: string }> = [];
  const requestBodies: Array<Record<string, unknown>> = [];

  const config = parseConnectorPumpConfig({
    FLOWSTATE_CONNECTOR_PUMP_TYPES: "webhook,slack",
    FLOWSTATE_CONNECTOR_PUMP_PROJECT_IDS: "proj-a,proj-b",
    FLOWSTATE_CONNECTOR_PUMP_LIMIT: "7",
  });

  const result = await pumpConnectorQueuesOnce({
    config,
    fetchImpl: async (url, init) => {
      seenRequests.push({ method: init?.method, url: String(url) });
      if (typeof init?.body === "string") {
        requestBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return jsonResponse(200, { processed_count: 1 });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 2);
  assert.equal(result.connector_count, 4);
  assert.equal(result.processed_count, 2);
  assert.deepEqual(result.failures, []);
  assert.equal(seenRequests.length, 2);
  assert.ok(seenRequests.every((request) => request.method === "POST"));
  assert.ok(seenRequests.every((request) => request.url.endsWith("/api/v2/connectors/process")));
  assert.equal(requestBodies.length, 2);
  assert.deepEqual(requestBodies[0]?.connectorTypes, ["webhook", "slack"]);
  assert.equal(requestBodies[0]?.limit, 7);
  assert.deepEqual(requestBodies[0]?.backpressure, {
    enabled: true,
    maxRetrying: 50,
    maxDueNow: 100,
    minLimit: 1,
  });
});

test("pumpConnectorQueuesOnce lists projects and keeps going on per-project failures", async () => {
  const seenRequests: Array<{ method?: string; url: string }> = [];
  let postCount = 0;

  const config = parseConnectorPumpConfig({
    FLOWSTATE_CONNECTOR_PUMP_TYPES: "webhook",
    FLOWSTATE_CONNECTOR_PUMP_ORGANIZATION_ID: "org_123",
  });

  const result = await pumpConnectorQueuesOnce({
    config,
    fetchImpl: async (url, init) => {
      const request = { method: init?.method, url: String(url) };
      seenRequests.push(request);

      if (request.method === "GET") {
        return jsonResponse(200, {
          projects: [{ id: "proj-a" }, { id: "proj-b" }],
        });
      }

      postCount += 1;
      if (postCount === 1) {
        return jsonResponse(200, { processed_count: 3 });
      }

      return jsonResponse(500, { error: "connector unavailable" });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 2);
  assert.equal(result.connector_count, 2);
  assert.equal(result.processed_count, 3);
  assert.equal(result.failures.length, 1);
  assert.ok(result.failures[0]?.includes("connector unavailable"));
  assert.ok(seenRequests[0]?.url.includes("/api/v2/projects?organizationId=org_123"));
  assert.ok(seenRequests[1]?.url.endsWith("/api/v2/connectors/process"));
  assert.ok(seenRequests[2]?.url.endsWith("/api/v2/connectors/process"));
});
