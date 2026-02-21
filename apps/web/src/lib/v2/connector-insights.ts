type ConnectorStatus = "queued" | "retrying" | "delivered" | "dead_lettered";

type ConnectorDeliveryLike = {
  id: string;
  status: ConnectorStatus;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type ConnectorAttemptLike = {
  success: boolean;
  error_message: string | null;
  created_at: string;
};

export type ConnectorInsights = {
  window_start: string;
  delivery_count: number;
  status_counts: {
    queued: number;
    retrying: number;
    delivered: number;
    dead_lettered: number;
  };
  delivery_success_rate: number;
  attempt_success_rate: number | null;
  avg_attempts_per_delivery: number;
  max_attempts_observed: number;
  top_errors: Array<{
    message: string;
    count: number;
  }>;
};

function parseIsoMs(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function round(value: number, decimals = 4) {
  return Number(value.toFixed(decimals));
}

export function computeConnectorInsights(input: {
  deliveries: ConnectorDeliveryLike[];
  attemptsByDeliveryId: Record<string, ConnectorAttemptLike[]>;
  lookbackHours: number;
  nowMs?: number;
}): ConnectorInsights {
  const nowMs = input.nowMs ?? Date.now();
  const lookbackMs = Math.max(1, input.lookbackHours) * 60 * 60 * 1000;
  const cutoffMs = nowMs - lookbackMs;

  const scopedDeliveries = input.deliveries.filter((delivery) => {
    const updatedAtMs = parseIsoMs(delivery.updated_at) ?? parseIsoMs(delivery.created_at);
    if (updatedAtMs === null) {
      return true;
    }
    return updatedAtMs >= cutoffMs;
  });

  const statusCounts = {
    queued: 0,
    retrying: 0,
    delivered: 0,
    dead_lettered: 0,
  };
  const errorCounts = new Map<string, number>();
  let attemptTotal = 0;
  let maxAttemptsObserved = 0;
  let successAttempts = 0;
  let failedAttempts = 0;

  for (const delivery of scopedDeliveries) {
    statusCounts[delivery.status] += 1;
    attemptTotal += delivery.attempt_count;
    maxAttemptsObserved = Math.max(maxAttemptsObserved, Math.max(0, delivery.attempt_count));

    if (delivery.last_error) {
      const normalized = delivery.last_error.trim();
      if (normalized.length > 0) {
        errorCounts.set(normalized, (errorCounts.get(normalized) ?? 0) + 1);
      }
    }

    const attempts = input.attemptsByDeliveryId[delivery.id] ?? [];
    for (const attempt of attempts) {
      const createdAtMs = parseIsoMs(attempt.created_at);
      if (createdAtMs !== null && createdAtMs < cutoffMs) {
        continue;
      }
      if (attempt.success) {
        successAttempts += 1;
      } else {
        failedAttempts += 1;
        if (attempt.error_message) {
          const normalized = attempt.error_message.trim();
          if (normalized.length > 0) {
            errorCounts.set(normalized, (errorCounts.get(normalized) ?? 0) + 1);
          }
        }
      }
    }
  }

  const deliveryCount = scopedDeliveries.length;
  const attemptCount = successAttempts + failedAttempts;
  const topErrors = [...errorCounts.entries()]
    .sort((left, right) => {
      if (right[1] === left[1]) {
        return left[0].localeCompare(right[0]);
      }
      return right[1] - left[1];
    })
    .slice(0, 5)
    .map(([message, count]) => ({ message, count }));

  return {
    window_start: new Date(cutoffMs).toISOString(),
    delivery_count: deliveryCount,
    status_counts: statusCounts,
    delivery_success_rate: deliveryCount > 0 ? round(statusCounts.delivered / deliveryCount) : 0,
    attempt_success_rate: attemptCount > 0 ? round(successAttempts / attemptCount) : null,
    avg_attempts_per_delivery: deliveryCount > 0 ? round(attemptTotal / deliveryCount) : 0,
    max_attempts_observed: maxAttemptsObserved,
    top_errors: topErrors,
  };
}
