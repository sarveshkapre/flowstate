import assert from "node:assert/strict";
import test from "node:test";

import { computeRetryBackoffMs, isConnectorDeliveryDue, isTerminalConnectorStatus } from "./connector-queue.ts";

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
