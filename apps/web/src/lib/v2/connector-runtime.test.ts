import assert from "node:assert/strict";
import test from "node:test";

import { normalizeConnectorType, validateConnectorConfig } from "./connector-runtime.ts";

test("normalizeConnectorType handles aliases", () => {
  assert.equal(normalizeConnectorType("webhook"), "webhook");
  assert.equal(normalizeConnectorType("slack_webhook"), "slack");
  assert.equal(normalizeConnectorType("jira_issue"), "jira");
  assert.equal(normalizeConnectorType("sink_sqs"), "sqs");
  assert.equal(normalizeConnectorType("database"), "db");
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

  const sqs = validateConnectorConfig("sqs", {
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
  });
  assert.equal(sqs.ok, false);
  assert.ok(sqs.errors[0]?.includes("Missing SQS config"));

  const db = validateConnectorConfig("db", {});
  assert.equal(db.ok, false);
  assert.ok(db.errors[0]?.includes("Missing DB config"));
});

test("validateConnectorConfig accepts valid webhook/slack/jira/sqs/db configs and redacts secrets", () => {
  const webhook = validateConnectorConfig("webhook", {
    targetUrl: "https://example.com/hook",
    headers: {
      Authorization: "Bearer abc123",
      "x-request-id": "flowstate",
    },
  });
  assert.equal(webhook.ok, true);
  const sanitizedHeaders = webhook.sanitizedConfig.headers as Record<string, unknown>;
  assert.equal(sanitizedHeaders.Authorization, "[redacted]");
  assert.equal(sanitizedHeaders["x-request-id"], "flowstate");

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

  const sqs = validateConnectorConfig("sqs", {
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/my-queue",
    accessKeyId: "AKIA_TEST",
    secretAccessKey: "test-secret-access-key",
    region: "us-east-1",
  });
  assert.equal(sqs.ok, true);
  assert.equal(sqs.sanitizedConfig.secretAccessKey, "[redacted]");

  const db = validateConnectorConfig("db", {
    ingestUrl: "https://ingest.example.com/records",
    table: "flowstate_events",
    apiKey: "db-secret-token",
  });
  assert.equal(db.ok, true);
  assert.equal(db.sanitizedConfig.apiKey, "[redacted]");
});
