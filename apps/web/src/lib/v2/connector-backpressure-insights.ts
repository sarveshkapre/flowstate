import type { AuditEventRecord, ConnectorDeliveryRecord } from "@flowstate/types";

export type ConnectorBackpressurePolicyUpdate = {
  id: string;
  actor: string | null;
  created_at: string;
  is_enabled: boolean;
  max_retrying: number;
  max_due_now: number;
  min_limit: number;
};

export type ConnectorBackpressureOutcomeSnapshot = {
  window_start: string;
  window_end: string;
  lookback_hours: number;
  total_deliveries: number;
  delivered: number;
  dead_lettered: number;
  retrying: number;
  queued: number;
  delivery_success_rate: number;
  dead_letter_rate: number;
};

export type ConnectorBackpressureOutcomeTrend = {
  current: ConnectorBackpressureOutcomeSnapshot;
  baseline: ConnectorBackpressureOutcomeSnapshot;
  delta: {
    delivery_success_rate: number;
    dead_letter_rate: number;
    delivered: number;
    dead_lettered: number;
    total_deliveries: number;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asPositiveInt(value: unknown, fallback: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

function asBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function summarizeWindow(input: {
  deliveries: ConnectorDeliveryRecord[];
  startMs: number;
  endMs: number;
  lookbackHours: number;
}) {
  let delivered = 0;
  let deadLettered = 0;
  let retrying = 0;
  let queued = 0;
  let total = 0;

  for (const delivery of input.deliveries) {
    const updatedAtMs = Date.parse(delivery.updated_at);
    if (!Number.isFinite(updatedAtMs) || updatedAtMs < input.startMs || updatedAtMs >= input.endMs) {
      continue;
    }

    total += 1;
    if (delivery.status === "delivered") {
      delivered += 1;
    } else if (delivery.status === "dead_lettered") {
      deadLettered += 1;
    } else if (delivery.status === "retrying") {
      retrying += 1;
    } else if (delivery.status === "queued") {
      queued += 1;
    }
  }

  const successRate = total > 0 ? delivered / total : 0;
  const deadLetterRate = total > 0 ? deadLettered / total : 0;

  return {
    window_start: new Date(input.startMs).toISOString(),
    window_end: new Date(input.endMs).toISOString(),
    lookback_hours: input.lookbackHours,
    total_deliveries: total,
    delivered,
    dead_lettered: deadLettered,
    retrying,
    queued,
    delivery_success_rate: Number(successRate.toFixed(4)),
    dead_letter_rate: Number(deadLetterRate.toFixed(4)),
  } satisfies ConnectorBackpressureOutcomeSnapshot;
}

export function summarizeConnectorBackpressureOutcomes(input: {
  deliveries: ConnectorDeliveryRecord[];
  lookbackHours: number;
  nowMs?: number;
}): ConnectorBackpressureOutcomeTrend {
  const lookbackHours = asPositiveInt(input.lookbackHours, 24, 24 * 30);
  const nowMs = input.nowMs ?? Date.now();
  const currentStartMs = nowMs - lookbackHours * 60 * 60 * 1000;
  const baselineStartMs = currentStartMs - lookbackHours * 60 * 60 * 1000;

  const current = summarizeWindow({
    deliveries: input.deliveries,
    startMs: currentStartMs,
    endMs: nowMs,
    lookbackHours,
  });
  const baseline = summarizeWindow({
    deliveries: input.deliveries,
    startMs: baselineStartMs,
    endMs: currentStartMs,
    lookbackHours,
  });

  return {
    current,
    baseline,
    delta: {
      delivery_success_rate: Number((current.delivery_success_rate - baseline.delivery_success_rate).toFixed(4)),
      dead_letter_rate: Number((current.dead_letter_rate - baseline.dead_letter_rate).toFixed(4)),
      delivered: current.delivered - baseline.delivered,
      dead_lettered: current.dead_lettered - baseline.dead_lettered,
      total_deliveries: current.total_deliveries - baseline.total_deliveries,
    },
  };
}

export function toConnectorBackpressurePolicyUpdate(event: AuditEventRecord): ConnectorBackpressurePolicyUpdate | null {
  if (event.event_type !== "connector_backpressure_policy_updated_v2") {
    return null;
  }

  const metadata = asRecord(event.metadata);
  if (!metadata) {
    return null;
  }

  return {
    id: event.id,
    actor: event.actor,
    created_at: event.created_at,
    is_enabled: asBoolean(metadata.is_enabled, true),
    max_retrying: asPositiveInt(metadata.max_retrying, 50, 10_000),
    max_due_now: asPositiveInt(metadata.max_due_now, 100, 10_000),
    min_limit: asPositiveInt(metadata.min_limit, 1, 100),
  };
}
