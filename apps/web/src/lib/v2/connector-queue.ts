export type ConnectorDeliveryStatus = "queued" | "retrying" | "delivered" | "dead_lettered";

export function isTerminalConnectorStatus(status: ConnectorDeliveryStatus) {
  return status === "delivered" || status === "dead_lettered";
}

export function computeRetryBackoffMs(initialBackoffMs: number, attemptNumber: number) {
  const normalizedInitial = Math.max(100, Math.min(initialBackoffMs, 60_000));
  const normalizedAttempt = Math.max(1, attemptNumber);
  return normalizedInitial * 2 ** (normalizedAttempt - 1);
}

export function isConnectorDeliveryDue(input: {
  status: ConnectorDeliveryStatus;
  nextAttemptAt: string | null;
  nowMs?: number;
}) {
  if (input.status === "delivered" || input.status === "dead_lettered") {
    return false;
  }

  if (input.status === "queued") {
    return true;
  }

  if (!input.nextAttemptAt) {
    return true;
  }

  const dueAt = Date.parse(input.nextAttemptAt);
  const nowMs = input.nowMs ?? Date.now();

  if (!Number.isFinite(dueAt)) {
    return true;
  }

  return dueAt <= nowMs;
}
