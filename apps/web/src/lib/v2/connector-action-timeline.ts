import type { AuditEventRecord } from "@flowstate/types";

export const CONNECTOR_ACTION_EVENT_TYPES = [
  "connector_delivery_queued_v2",
  "connector_delivery_attempted_v2",
  "connector_delivered_v2",
  "connector_dead_lettered_v2",
] as const;

export type ConnectorActionEventType = (typeof CONNECTOR_ACTION_EVENT_TYPES)[number];

export type ConnectorActionTimelineEvent = {
  id: string;
  event_type: ConnectorActionEventType;
  actor: string | null;
  created_at: string;
  connector_type: string | null;
  project_id: string | null;
  delivery_id: string | null;
  attempt_number: number | null;
  success: boolean | null;
  status_code: number | null;
  reason: string | null;
  redrive: boolean;
  batch: boolean;
};

export type ConnectorActionTimelineSummary = {
  total: number;
  queued: number;
  attempted: number;
  delivered: number;
  dead_lettered: number;
  redrive_queued: number;
  by_connector: Array<{
    connector_type: string;
    total: number;
    dead_lettered: number;
    delivered: number;
  }>;
};

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function isConnectorActionEventType(value: string): value is ConnectorActionEventType {
  return CONNECTOR_ACTION_EVENT_TYPES.includes(value as ConnectorActionEventType);
}

export function toConnectorActionTimelineEvent(input: {
  event: AuditEventRecord;
  fallback?: { project_id?: string | null; connector_type?: string | null };
}): ConnectorActionTimelineEvent | null {
  if (!isConnectorActionEventType(input.event.event_type)) {
    return null;
  }

  const metadata = asRecord(input.event.metadata);
  const connectorTypeRaw = metadata?.connector_type;
  const projectIdRaw = metadata?.project_id;
  const deliveryIdRaw = metadata?.delivery_id;
  const attemptRaw = metadata?.attempt_number;
  const successRaw = metadata?.success;
  const statusCodeRaw = metadata?.status_code;
  const reasonRaw = metadata?.reason;
  const redriveRaw = metadata?.redrive;
  const batchRaw = metadata?.batch;

  return {
    id: input.event.id,
    event_type: input.event.event_type,
    actor: input.event.actor,
    created_at: input.event.created_at,
    connector_type:
      typeof connectorTypeRaw === "string"
        ? connectorTypeRaw
        : (input.fallback?.connector_type ?? null),
    project_id: typeof projectIdRaw === "string" ? projectIdRaw : (input.fallback?.project_id ?? null),
    delivery_id: typeof deliveryIdRaw === "string" ? deliveryIdRaw : null,
    attempt_number: typeof attemptRaw === "number" && Number.isFinite(attemptRaw) ? attemptRaw : null,
    success: typeof successRaw === "boolean" ? successRaw : null,
    status_code: typeof statusCodeRaw === "number" && Number.isFinite(statusCodeRaw) ? statusCodeRaw : null,
    reason: typeof reasonRaw === "string" && reasonRaw.trim().length > 0 ? reasonRaw.trim() : null,
    redrive: redriveRaw === true,
    batch: batchRaw === true,
  };
}

export function summarizeConnectorActionTimeline(events: ConnectorActionTimelineEvent[]): ConnectorActionTimelineSummary {
  const byConnector = new Map<string, { connector_type: string; total: number; dead_lettered: number; delivered: number }>();
  const summary: Omit<ConnectorActionTimelineSummary, "by_connector"> = {
    total: events.length,
    queued: 0,
    attempted: 0,
    delivered: 0,
    dead_lettered: 0,
    redrive_queued: 0,
  };

  for (const event of events) {
    if (event.event_type === "connector_delivery_queued_v2") {
      summary.queued += 1;
      if (event.redrive) {
        summary.redrive_queued += 1;
      }
    } else if (event.event_type === "connector_delivery_attempted_v2") {
      summary.attempted += 1;
    } else if (event.event_type === "connector_delivered_v2") {
      summary.delivered += 1;
    } else if (event.event_type === "connector_dead_lettered_v2") {
      summary.dead_lettered += 1;
    }

    if (!event.connector_type) {
      continue;
    }

    const current = byConnector.get(event.connector_type) ?? {
      connector_type: event.connector_type,
      total: 0,
      dead_lettered: 0,
      delivered: 0,
    };
    current.total += 1;
    if (event.event_type === "connector_dead_lettered_v2") {
      current.dead_lettered += 1;
    }
    if (event.event_type === "connector_delivered_v2") {
      current.delivered += 1;
    }
    byConnector.set(event.connector_type, current);
  }

  return {
    ...summary,
    by_connector: [...byConnector.values()].sort((left, right) => {
      if (right.total !== left.total) {
        return right.total - left.total;
      }
      return left.connector_type.localeCompare(right.connector_type);
    }),
  };
}
