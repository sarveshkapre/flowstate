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
  assert.deepEqual(config.connectorTypes, ["webhook", "slack", "jira"]);
  assert.equal(config.redriveLimit, 10);
  assert.equal(config.minDeadLetterCount, 3);
  assert.equal(config.minDeadLetterMinutes, 15);
  assert.equal(config.processAfterRedrive, true);
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
  });

  assert.equal(config.apiBaseUrl, "http://localhost:3010");
  assert.deepEqual(config.connectorTypes, ["slack", "webhook"]);
  assert.deepEqual(config.projectIds, ["p1", "p2"]);
  assert.equal(config.redriveLimit, 100);
  assert.equal(config.minDeadLetterCount, 2);
  assert.equal(config.minDeadLetterMinutes, 15);
  assert.equal(config.processAfterRedrive, false);
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
        summary: {
          dead_lettered: 2,
        },
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
});

test("runConnectorRedriveOnce redrives batch and processes queue", async () => {
  const seenRequests: Array<{ method?: string; url: string }> = [];
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

      if (request.method === "GET") {
        return jsonResponse(200, {
          summary: {
            dead_lettered: 8,
          },
        });
      }

      if (request.url.includes("action=redrive_batch")) {
        return jsonResponse(200, {
          redriven_count: 4,
        });
      }

      return jsonResponse(200, {
        processed_count: 3,
      });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.redriven_count, 4);
  assert.equal(result.processed_count, 3);
  assert.equal(result.skipped_count, 0);
  assert.deepEqual(result.failures, []);
  assert.equal(seenRequests.length, 3);
  assert.ok(seenRequests[1]?.url.includes("action=redrive_batch"));
  assert.ok(seenRequests[2]?.url.includes("action=process"));
});

test("runConnectorRedriveOnce continues after connector-specific failures", async () => {
  let call = 0;
  const config = parseConnectorRedriveConfig({
    FLOWSTATE_CONNECTOR_REDRIVE_PROJECT_IDS: "proj-1",
    FLOWSTATE_CONNECTOR_REDRIVE_TYPES: "webhook,slack",
  });

  const result = await runConnectorRedriveOnce({
    config,
    fetchImpl: async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse(500, { error: "list failed" });
      }
      if (call === 2) {
        return jsonResponse(200, { summary: { dead_lettered: 4 } });
      }
      if (call === 3) {
        return jsonResponse(200, { redriven_count: 2 });
      }
      return jsonResponse(200, { processed_count: 2 });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.connector_count, 2);
  assert.equal(result.failures.length, 1);
  assert.ok(result.failures[0]?.includes("failed to inspect dead-letter queue"));
  assert.equal(result.redriven_count, 2);
  assert.equal(result.processed_count, 2);
});
