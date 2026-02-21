import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConnectorBackpressureCandidatePolicy,
  simulateConnectorBackpressurePolicy,
} from "./connector-backpressure-simulation.ts";

test("buildConnectorBackpressureCandidatePolicy canonicalizes connector overrides and applies defaults", () => {
  const candidate = buildConnectorBackpressureCandidatePolicy({
    projectId: "proj_1",
    basePolicy: null,
    update: {
      enabled: true,
      maxRetrying: 60,
      maxDueNow: 110,
      minLimit: 2,
      byConnector: {
        slack_webhook: {
          maxRetrying: 25,
          maxDueNow: 40,
          minLimit: 1,
          enabled: false,
        },
      },
    },
  });

  assert.equal(candidate.is_enabled, true);
  assert.equal(candidate.max_retrying, 60);
  assert.equal(candidate.max_due_now, 110);
  assert.equal(candidate.min_limit, 2);
  assert.ok(candidate.connector_overrides.slack);
  assert.equal(candidate.connector_overrides.slack?.is_enabled, false);
  assert.equal(candidate.connector_overrides.slack?.max_retrying, 25);
});

test("simulateConnectorBackpressurePolicy compares current and candidate decisions", () => {
  const currentPolicy = buildConnectorBackpressureCandidatePolicy({
    projectId: "proj_1",
    basePolicy: null,
    update: {
      enabled: true,
      maxRetrying: 50,
      maxDueNow: 100,
      minLimit: 1,
    },
  });
  const candidatePolicy = buildConnectorBackpressureCandidatePolicy({
    projectId: "proj_1",
    basePolicy: currentPolicy,
    update: {
      byConnector: {
        jira: {
          enabled: false,
        },
      },
    },
  });

  const simulation = simulateConnectorBackpressurePolicy({
    connectorTypes: ["jira", "webhook"],
    requestedLimit: 20,
    summariesByConnector: {
      jira: {
        queued: 100,
        retrying: 80,
        due_now: 20,
      },
      webhook: {
        queued: 5,
        retrying: 0,
        due_now: 0,
      },
    },
    currentPolicy,
    candidatePolicy,
  });

  assert.equal(simulation.connector_count, 2);
  assert.equal(simulation.throttled_before, 1);
  assert.equal(simulation.throttled_after, 0);
  assert.equal(simulation.throttled_delta, -1);

  const jira = simulation.per_connector.find((item) => item.connector_type === "jira");
  assert.ok(jira);
  assert.equal(jira?.current.decision.throttled, true);
  assert.equal(jira?.candidate.decision.throttled, false);
  assert.equal(jira?.impact.effective_limit_delta, 19);
});

test("buildConnectorBackpressureCandidatePolicy keeps existing overrides when update omits overrides", () => {
  const basePolicy = buildConnectorBackpressureCandidatePolicy({
    projectId: "proj_1",
    basePolicy: null,
    update: {
      byConnector: {
        db: {
          enabled: false,
          maxRetrying: 12,
          maxDueNow: 20,
          minLimit: 1,
        },
      },
    },
  });

  const candidate = buildConnectorBackpressureCandidatePolicy({
    projectId: "proj_1",
    basePolicy,
    update: {
      maxRetrying: 90,
    },
  });

  assert.equal(candidate.max_retrying, 90);
  assert.ok(candidate.connector_overrides.db);
  assert.equal(candidate.connector_overrides.db?.max_retrying, 12);
});
