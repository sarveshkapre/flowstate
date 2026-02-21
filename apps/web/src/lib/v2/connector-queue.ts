export type ConnectorDeliveryStatus = "queued" | "retrying" | "delivered" | "dead_lettered";

export type ConnectorRedriveResetFields = {
  status: "queued";
  attempt_count: 0;
  next_attempt_at: null;
  dead_letter_reason: null;
  last_error: null;
  last_status_code: null;
  delivered_at: null;
  updated_at: string;
};

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

export function isConnectorDeadLetterEligibleForRedrive(input: {
  status: ConnectorDeliveryStatus;
  updatedAt: string;
  minDeadLetterMinutes?: number;
  nowMs?: number;
}) {
  if (input.status !== "dead_lettered") {
    return false;
  }

  const minMinutes = input.minDeadLetterMinutes ?? 0;
  if (minMinutes <= 0) {
    return true;
  }

  const updatedAtMs = Date.parse(input.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return true;
  }

  const nowMs = input.nowMs ?? Date.now();
  return updatedAtMs + minMinutes * 60_000 <= nowMs;
}

export function connectorRedriveResetFields(nowIso: string): ConnectorRedriveResetFields {
  return {
    status: "queued",
    attempt_count: 0,
    next_attempt_at: null,
    dead_letter_reason: null,
    last_error: null,
    last_status_code: null,
    delivered_at: null,
    updated_at: nowIso,
  };
}
