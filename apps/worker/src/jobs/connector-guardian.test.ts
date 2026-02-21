import assert from "node:assert/strict";
import test from "node:test";

import { parseConnectorGuardianConfig, runConnectorGuardianOnce } from "./connector-guardian";

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("parseConnectorGuardianConfig applies defaults", () => {
  const config = parseConnectorGuardianConfig({});

  assert.equal(config.apiBaseUrl, "http://localhost:3000");
  assert.deepEqual(config.connectorTypes, ["webhook", "slack", "jira", "sqs", "db"]);
  assert.equal(config.pollMs, 60_000);
  assert.equal(config.lookbackHours, 24);
  assert.equal(config.riskThreshold, 20);
  assert.equal(config.maxActionsPerProject, 2);
  assert.equal(config.actionLimit, 10);
  assert.equal(config.minDeadLetterMinutes, 15);
  assert.equal(config.allowProcessQueue, true);
  assert.equal(config.allowRedriveDeadLetters, true);
});

test("parseConnectorGuardianConfig normalizes values and ignores unsupported connector types", () => {
  const config = parseConnectorGuardianConfig({
    FLOWSTATE_LOCAL_API_BASE: "http://localhost:3010/",
    FLOWSTATE_CONNECTOR_GUARDIAN_TYPES: "Slack,custom,webhook",
    FLOWSTATE_CONNECTOR_GUARDIAN_PROJECT_IDS: " p1, p2, p1 ",
    FLOWSTATE_CONNECTOR_GUARDIAN_POLL_MS: "1",
    FLOWSTATE_CONNECTOR_GUARDIAN_LOOKBACK_HOURS: "9999",
    FLOWSTATE_CONNECTOR_GUARDIAN_RISK_THRESHOLD: "45.5",
    FLOWSTATE_CONNECTOR_GUARDIAN_MAX_ACTIONS_PER_PROJECT: "99",
    FLOWSTATE_CONNECTOR_GUARDIAN_ACTION_LIMIT: "500",
    FLOWSTATE_CONNECTOR_GUARDIAN_MIN_DEAD_LETTER_MINUTES: "0",
    FLOWSTATE_CONNECTOR_GUARDIAN_ALLOW_PROCESS_QUEUE: "false",
    FLOWSTATE_CONNECTOR_GUARDIAN_ALLOW_REDRIVE_DEAD_LETTERS: "0",
  });

  assert.equal(config.apiBaseUrl, "http://localhost:3010");
  assert.deepEqual(config.connectorTypes, ["slack", "webhook"]);
  assert.deepEqual(config.projectIds, ["p1", "p2"]);
  assert.equal(config.pollMs, 1);
  assert.equal(config.lookbackHours, 720);
  assert.equal(config.riskThreshold, 45.5);
  assert.equal(config.maxActionsPerProject, 20);
  assert.equal(config.actionLimit, 100);
  assert.equal(config.minDeadLetterMinutes, 15);
  assert.equal(config.allowProcessQueue, false);
  assert.equal(config.allowRedriveDeadLetters, false);
});

test("runConnectorGuardianOnce executes top recommendations above threshold", async () => {
  const seenRequests: Array<{ method?: string; url: string }> = [];
  const requestBodies: Array<Record<string, unknown>> = [];
  const config = parseConnectorGuardianConfig({
    FLOWSTATE_CONNECTOR_GUARDIAN_PROJECT_IDS: "proj-1",
    FLOWSTATE_CONNECTOR_GUARDIAN_TYPES: "webhook,jira,slack",
    FLOWSTATE_CONNECTOR_GUARDIAN_RISK_THRESHOLD: "10",
  });

  const result = await runConnectorGuardianOnce({
    config,
    fetchImpl: async (url, init) => {
      const request = { method: init?.method, url: String(url) };
      seenRequests.push(request);

      if (typeof init?.body === "string") {
        requestBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return jsonResponse(200, {
        selected_actions: [
          { connector_type: "webhook", recommendation: "redrive_dead_letters", risk_score: 55 },
          { connector_type: "jira", recommendation: "process_queue", risk_score: 22 },
        ],
        action_results: [
          { connector_type: "webhook", recommendation: "redrive_dead_letters" },
          { connector_type: "jira", recommendation: "process_queue" },
        ],
      });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 1);
  assert.equal(result.connector_count, 3);
  assert.equal(result.candidate_count, 2);
  assert.equal(result.actioned_count, 2);
  assert.equal(result.process_actions, 1);
  assert.equal(result.redrive_actions, 1);
  assert.equal(result.skipped_count, 0);
  assert.deepEqual(result.failures, []);
  assert.equal(seenRequests.length, 1);
  assert.equal(seenRequests[0]?.method, "POST");
  assert.ok(seenRequests[0]?.url.endsWith("/api/v2/connectors/recommendations/run"));
  assert.equal(requestBodies.length, 1);
  assert.equal(requestBodies[0]?.projectId, "proj-1");
  assert.deepEqual(requestBodies[0]?.connectorTypes, ["webhook", "jira", "slack"]);
});

test("runConnectorGuardianOnce skips projects with no actionable recommendations", async () => {
  const config = parseConnectorGuardianConfig({
    FLOWSTATE_CONNECTOR_GUARDIAN_PROJECT_IDS: "proj-1",
    FLOWSTATE_CONNECTOR_GUARDIAN_TYPES: "webhook",
    FLOWSTATE_CONNECTOR_GUARDIAN_RISK_THRESHOLD: "50",
  });

  const result = await runConnectorGuardianOnce({
    config,
    fetchImpl: async () => jsonResponse(200, { selected_actions: [], action_results: [] }),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 1);
  assert.equal(result.connector_count, 1);
  assert.equal(result.candidate_count, 0);
  assert.equal(result.actioned_count, 0);
  assert.equal(result.skipped_count, 1);
  assert.deepEqual(result.failures, []);
});

test("runConnectorGuardianOnce continues after action failures", async () => {
  let requestCall = 0;
  const config = parseConnectorGuardianConfig({
    FLOWSTATE_CONNECTOR_GUARDIAN_PROJECT_IDS: "proj-1,proj-2",
    FLOWSTATE_CONNECTOR_GUARDIAN_TYPES: "webhook,jira",
    FLOWSTATE_CONNECTOR_GUARDIAN_RISK_THRESHOLD: "10",
  });

  const result = await runConnectorGuardianOnce({
    config,
    fetchImpl: async () => {
      requestCall += 1;
      if (requestCall === 1) {
        return jsonResponse(500, { error: "run failed" });
      }

      return jsonResponse(200, {
        selected_actions: [
          { connector_type: "webhook", recommendation: "redrive_dead_letters", risk_score: 55 },
          { connector_type: "jira", recommendation: "process_queue", risk_score: 35 },
        ],
        action_results: [
          { connector_type: "webhook", recommendation: "redrive_dead_letters" },
          { connector_type: "jira", recommendation: "process_queue" },
        ],
      });
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });

  assert.equal(result.project_count, 2);
  assert.equal(result.connector_count, 4);
  assert.equal(result.candidate_count, 2);
  assert.equal(result.actioned_count, 2);
  assert.equal(result.failures.length, 1);
  assert.ok(result.failures[0]?.includes("failed to run connector recommendations"));
});
