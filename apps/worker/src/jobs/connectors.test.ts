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
  assert.equal(config.pollMs, 5000);
  assert.deepEqual(config.projectIds, []);
});

test("parseConnectorPumpConfig normalizes custom values and clamps limits", () => {
  const config = parseConnectorPumpConfig({
    FLOWSTATE_LOCAL_API_BASE: "http://localhost:3100/",
    FLOWSTATE_CONNECTOR_PUMP_TYPES: "Webhook, jira, webhook",
    FLOWSTATE_CONNECTOR_PUMP_LIMIT: "999",
    FLOWSTATE_CONNECTOR_PUMP_POLL_MS: "0",
    FLOWSTATE_CONNECTOR_PUMP_PROJECT_IDS: " p1, p2 ,p1 ",
  });

  assert.equal(config.apiBaseUrl, "http://localhost:3100");
  assert.deepEqual(config.connectorTypes, ["webhook", "jira"]);
  assert.equal(config.limit, 100);
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

  const config = parseConnectorPumpConfig({
    FLOWSTATE_CONNECTOR_PUMP_TYPES: "webhook,slack",
    FLOWSTATE_CONNECTOR_PUMP_PROJECT_IDS: "proj-a,proj-b",
    FLOWSTATE_CONNECTOR_PUMP_LIMIT: "7",
  });

  const result = await pumpConnectorQueuesOnce({
    config,
    fetchImpl: async (url, init) => {
      seenRequests.push({ method: init?.method, url: String(url) });
      return jsonResponse(200, { processed_count: 1 });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 2);
  assert.equal(result.connector_count, 4);
  assert.equal(result.processed_count, 4);
  assert.deepEqual(result.failures, []);
  assert.equal(seenRequests.length, 4);
  assert.ok(seenRequests.every((request) => request.method === "PATCH"));
});

test("pumpConnectorQueuesOnce lists projects and keeps going on per-connector failures", async () => {
  const seenRequests: Array<{ method?: string; url: string }> = [];
  let patchCount = 0;

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

      patchCount += 1;
      if (patchCount === 1) {
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
});
