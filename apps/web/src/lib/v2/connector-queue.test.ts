import assert from "node:assert/strict";
import test from "node:test";

import {
  computeRetryBackoffMs,
  connectorRedriveResetFields,
  isConnectorDeadLetterEligibleForRedrive,
  isConnectorDeliveryDue,
  isTerminalConnectorStatus,
} from "./connector-queue.ts";

test("computeRetryBackoffMs grows exponentially and clamps initial value", () => {
  assert.equal(computeRetryBackoffMs(500, 1), 500);
  assert.equal(computeRetryBackoffMs(500, 2), 1000);
  assert.equal(computeRetryBackoffMs(50, 1), 100);
});

test("isTerminalConnectorStatus flags delivered/dead-lettered", () => {
  assert.equal(isTerminalConnectorStatus("delivered"), true);
  assert.equal(isTerminalConnectorStatus("dead_lettered"), true);
  assert.equal(isTerminalConnectorStatus("queued"), false);
});

test("isConnectorDeliveryDue handles queued, retry timing, and terminal states", () => {
  const nowMs = Date.parse("2026-02-21T00:00:00.000Z");

  assert.equal(
    isConnectorDeliveryDue({
      status: "queued",
      nextAttemptAt: null,
      nowMs,
    }),
    true,
  );

  assert.equal(
    isConnectorDeliveryDue({
      status: "retrying",
      nextAttemptAt: "2026-02-20T23:59:59.000Z",
      nowMs,
    }),
    true,
  );

  assert.equal(
    isConnectorDeliveryDue({
      status: "retrying",
      nextAttemptAt: "2026-02-21T00:00:01.000Z",
      nowMs,
    }),
    false,
  );

  assert.equal(
    isConnectorDeliveryDue({
      status: "dead_lettered",
      nextAttemptAt: null,
      nowMs,
    }),
    false,
  );
});

test("isConnectorDeadLetterEligibleForRedrive enforces minimum dead-letter age", () => {
  const nowMs = Date.parse("2026-02-21T00:30:00.000Z");

  assert.equal(
    isConnectorDeadLetterEligibleForRedrive({
      status: "dead_lettered",
      updatedAt: "2026-02-21T00:00:00.000Z",
      minDeadLetterMinutes: 20,
      nowMs,
    }),
    true,
  );

  assert.equal(
    isConnectorDeadLetterEligibleForRedrive({
      status: "dead_lettered",
      updatedAt: "2026-02-21T00:20:00.000Z",
      minDeadLetterMinutes: 20,
      nowMs,
    }),
    false,
  );

  assert.equal(
    isConnectorDeadLetterEligibleForRedrive({
      status: "queued",
      updatedAt: "2026-02-21T00:00:00.000Z",
      minDeadLetterMinutes: 0,
      nowMs,
    }),
    false,
  );
});

test("connectorRedriveResetFields resets delivery state for retry", () => {
  const reset = connectorRedriveResetFields("2026-02-21T01:00:00.000Z");

  assert.deepEqual(reset, {
    status: "queued",
    attempt_count: 0,
    next_attempt_at: null,
    dead_letter_reason: null,
    last_error: null,
    last_status_code: null,
    delivered_at: null,
    updated_at: "2026-02-21T01:00:00.000Z",
  });
});
