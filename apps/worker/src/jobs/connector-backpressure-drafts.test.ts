import assert from "node:assert/strict";
import test from "node:test";

import {
  parseConnectorBackpressureDraftActivationConfig,
  runConnectorBackpressureDraftActivationOnce,
} from "./connector-backpressure-drafts";

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("parseConnectorBackpressureDraftActivationConfig applies defaults", () => {
  const config = parseConnectorBackpressureDraftActivationConfig({});

  assert.equal(config.apiBaseUrl, "http://localhost:3000");
  assert.deepEqual(config.projectIds, []);
  assert.equal(config.organizationId, null);
  assert.equal(config.apiKey, null);
  assert.equal(config.actorEmail, "connector-backpressure-drafts@flowstate.dev");
  assert.equal(config.pollMs, 60_000);
  assert.equal(config.limit, 100);
  assert.equal(config.dryRun, false);
});

test("parseConnectorBackpressureDraftActivationConfig normalizes custom values", () => {
  const config = parseConnectorBackpressureDraftActivationConfig({
    FLOWSTATE_LOCAL_API_BASE: "http://localhost:3010/",
    FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_PROJECT_IDS: " p1, p2, p1 ",
    FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_ORGANIZATION_ID: "org-123",
    FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_API_KEY: "abc123",
    FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_ACTOR_EMAIL: "ops@flowstate.dev",
    FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_POLL_MS: "9999999",
    FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_LIMIT: "999999",
    FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_DRY_RUN: "true",
  });

  assert.equal(config.apiBaseUrl, "http://localhost:3010");
  assert.deepEqual(config.projectIds, ["p1", "p2"]);
  assert.equal(config.organizationId, "org-123");
  assert.equal(config.apiKey, "abc123");
  assert.equal(config.actorEmail, "ops@flowstate.dev");
  assert.equal(config.pollMs, 3_600_000);
  assert.equal(config.limit, 500);
  assert.equal(config.dryRun, true);
});

test("runConnectorBackpressureDraftActivationOnce posts activation with explicit project IDs", async () => {
  const seenRequests: Array<{ method?: string; url: string }> = [];
  const requestBodies: Array<Record<string, unknown>> = [];
  const config = parseConnectorBackpressureDraftActivationConfig({
    FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_PROJECT_IDS: "proj-1,proj-2",
    FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_DRY_RUN: "false",
    FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_LIMIT: "77",
  });

  const result = await runConnectorBackpressureDraftActivationOnce({
    config,
    fetchImpl: async (url, init) => {
      seenRequests.push({ method: init?.method, url: String(url) });
      if (typeof init?.body === "string") {
        requestBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }

      return jsonResponse(200, {
        project_count: 2,
        total_draft_count: 4,
        scanned_draft_count: 4,
        ready_count: 0,
        blocked_count: 1,
        applied_count: 3,
        failed_count: 0,
      });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 2);
  assert.equal(result.total_draft_count, 4);
  assert.equal(result.applied_count, 3);
  assert.equal(result.blocked_count, 1);
  assert.deepEqual(result.failures, []);
  assert.equal(seenRequests.length, 1);
  assert.equal(seenRequests[0]?.method, "POST");
  assert.ok(seenRequests[0]?.url.endsWith("/api/v2/connectors/backpressure/drafts/activate"));
  assert.equal(requestBodies.length, 1);
  assert.deepEqual(requestBodies[0]?.projectIds, ["proj-1", "proj-2"]);
  assert.equal(requestBodies[0]?.dryRun, false);
  assert.equal(requestBodies[0]?.limit, 77);
});

test("runConnectorBackpressureDraftActivationOnce resolves organization scope before activation", async () => {
  const seenRequests: Array<{ method?: string; url: string }> = [];
  const requestBodies: Array<Record<string, unknown>> = [];
  const config = parseConnectorBackpressureDraftActivationConfig({
    FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_ORGANIZATION_ID: "org-123",
    FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_DRY_RUN: "1",
  });

  const result = await runConnectorBackpressureDraftActivationOnce({
    config,
    fetchImpl: async (url, init) => {
      const request = { method: init?.method, url: String(url) };
      seenRequests.push(request);

      if (request.url.includes("/api/v2/projects")) {
        return jsonResponse(200, {
          projects: [{ id: "proj-a" }, { id: "proj-b" }],
        });
      }

      if (typeof init?.body === "string") {
        requestBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }

      return jsonResponse(200, {
        project_count: 2,
        total_draft_count: 2,
        scanned_draft_count: 2,
        ready_count: 2,
        blocked_count: 0,
        applied_count: 0,
        failed_count: 0,
      });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 2);
  assert.equal(result.ready_count, 2);
  assert.deepEqual(result.failures, []);
  assert.equal(seenRequests.length, 2);
  assert.ok(seenRequests[0]?.url.includes("/api/v2/projects?organizationId=org-123"));
  assert.ok(seenRequests[1]?.url.endsWith("/api/v2/connectors/backpressure/drafts/activate"));
  assert.equal(requestBodies.length, 1);
  assert.deepEqual(requestBodies[0]?.projectIds, ["proj-a", "proj-b"]);
  assert.equal(requestBodies[0]?.dryRun, true);
});

test("runConnectorBackpressureDraftActivationOnce reports API failures", async () => {
  const config = parseConnectorBackpressureDraftActivationConfig({
    FLOWSTATE_CONNECTOR_BACKPRESSURE_DRAFTS_PROJECT_IDS: "proj-1",
  });

  const result = await runConnectorBackpressureDraftActivationOnce({
    config,
    fetchImpl: async () => jsonResponse(500, { error: "activation unavailable" }),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 1);
  assert.equal(result.applied_count, 0);
  assert.equal(result.failures.length, 1);
  assert.ok(result.failures[0]?.includes("failed to activate connector backpressure drafts"));
});
