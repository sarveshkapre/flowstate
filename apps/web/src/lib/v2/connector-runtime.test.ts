import assert from "node:assert/strict";
import test from "node:test";

import { normalizeConnectorType, validateConnectorConfig } from "./connector-runtime.ts";

test("normalizeConnectorType handles aliases", () => {
  assert.equal(normalizeConnectorType("webhook"), "webhook");
  assert.equal(normalizeConnectorType("slack_webhook"), "slack");
  assert.equal(normalizeConnectorType("jira_issue"), "jira");
  assert.equal(normalizeConnectorType("unknown"), null);
});

test("validateConnectorConfig fails when required settings are missing", () => {
  const webhook = validateConnectorConfig("webhook", {});
  assert.equal(webhook.ok, false);
  assert.ok(webhook.errors[0]?.includes("Missing webhook target URL"));

  const jira = validateConnectorConfig("jira", {
    baseUrl: "https://company.atlassian.net",
  });
  assert.equal(jira.ok, false);
  assert.ok(jira.errors[0]?.includes("Missing Jira config"));
});

test("validateConnectorConfig accepts valid webhook/slack/jira configs and redacts secrets", () => {
  const webhook = validateConnectorConfig("webhook", {
    targetUrl: "https://example.com/hook",
  });
  assert.equal(webhook.ok, true);

  const slack = validateConnectorConfig("slack", {
    webhookUrl: "https://hooks.slack.com/services/a/b/c",
  });
  assert.equal(slack.ok, true);

  const jira = validateConnectorConfig("jira", {
    baseUrl: "https://company.atlassian.net",
    email: "ops@company.com",
    apiToken: "super-secret-token",
    projectKey: "OPS",
  });
  assert.equal(jira.ok, true);
  assert.equal(jira.sanitizedConfig.apiToken, "[redacted]");
});
