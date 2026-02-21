import assert from "node:assert/strict";
import test from "node:test";

import { resolveConnectorBackpressureConfig } from "./connector-backpressure-policy.ts";

test("resolveConnectorBackpressureConfig prefers request override when provided for connector", () => {
  const resolved = resolveConnectorBackpressureConfig({
    connectorType: "slack",
    requestBackpressure: {
      enabled: true,
      maxRetrying: 50,
      maxDueNow: 100,
      minLimit: 1,
      byConnector: {
        slack: {
          enabled: false,
          maxRetrying: 10,
          maxDueNow: 20,
          minLimit: 2,
        },
      },
    },
  });

  assert.equal(resolved.source, "request_connector_override");
  assert.equal(resolved.policy_applied, false);
  assert.equal(resolved.config?.enabled, false);
  assert.equal(resolved.config?.maxRetrying, 10);
  assert.equal(resolved.config?.maxDueNow, 20);
  assert.equal(resolved.config?.minLimit, 2);
});

test("resolveConnectorBackpressureConfig falls back to request default when override is missing", () => {
  const resolved = resolveConnectorBackpressureConfig({
    connectorType: "jira",
    requestBackpressure: {
      enabled: true,
      maxRetrying: 30,
      maxDueNow: 60,
      minLimit: 3,
    },
  });

  assert.equal(resolved.source, "request_default");
  assert.equal(resolved.policy_applied, false);
  assert.equal(resolved.config?.enabled, true);
  assert.equal(resolved.config?.maxRetrying, 30);
  assert.equal(resolved.config?.maxDueNow, 60);
  assert.equal(resolved.config?.minLimit, 3);
});

test("resolveConnectorBackpressureConfig applies connector-specific policy override", () => {
  const resolved = resolveConnectorBackpressureConfig({
    connectorType: "db",
    policy: {
      id: "policy_1",
      project_id: "proj_1",
      is_enabled: true,
      max_retrying: 80,
      max_due_now: 120,
      min_limit: 2,
      connector_overrides: {
        db: {
          is_enabled: false,
          max_retrying: 15,
          max_due_now: 25,
          min_limit: 1,
        },
      },
      created_at: "2026-02-21T00:00:00.000Z",
      updated_at: "2026-02-21T00:00:00.000Z",
    },
  });

  assert.equal(resolved.source, "policy_connector_override");
  assert.equal(resolved.policy_applied, true);
  assert.equal(resolved.config?.enabled, false);
  assert.equal(resolved.config?.maxRetrying, 15);
  assert.equal(resolved.config?.maxDueNow, 25);
  assert.equal(resolved.config?.minLimit, 1);
});

test("resolveConnectorBackpressureConfig falls back to global policy defaults", () => {
  const resolved = resolveConnectorBackpressureConfig({
    connectorType: "webhook",
    policy: {
      id: "policy_1",
      project_id: "proj_1",
      is_enabled: true,
      max_retrying: 80,
      max_due_now: 120,
      min_limit: 2,
      connector_overrides: {},
      created_at: "2026-02-21T00:00:00.000Z",
      updated_at: "2026-02-21T00:00:00.000Z",
    },
  });

  assert.equal(resolved.source, "policy_default");
  assert.equal(resolved.policy_applied, true);
  assert.equal(resolved.config?.enabled, true);
  assert.equal(resolved.config?.maxRetrying, 80);
  assert.equal(resolved.config?.maxDueNow, 120);
  assert.equal(resolved.config?.minLimit, 2);
});
