import { NextResponse } from "next/server";
import { z } from "zod";

import { getConnectorDelivery, listV2AuditEvents } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import {
  summarizeConnectorActionTimeline,
  toConnectorActionTimelineEvent,
  type ConnectorActionTimelineEvent,
} from "@/lib/v2/connector-action-timeline";
import { connectorTypeSchema } from "@/lib/v2/request-security";

const querySchema = z.object({
  projectId: z.string().min(1),
  connectorType: connectorTypeSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    projectId: url.searchParams.get("projectId"),
    connectorType: url.searchParams.get("connectorType") || undefined,
    limit: url.searchParams.get("limit") || undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json({ error: "Invalid query params", details: parsedQuery.error.flatten() }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: parsedQuery.data.projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const rawEvents = await listV2AuditEvents(Math.max(parsedQuery.data.limit * 6, 300));
  const fallbackByDeliveryId = new Map<string, { project_id: string | null; connector_type: string | null }>();
  const timeline: ConnectorActionTimelineEvent[] = [];

  for (const event of rawEvents) {
    const mappedDirect = toConnectorActionTimelineEvent({ event });
    if (!mappedDirect) {
      continue;
    }

    let mapped = mappedDirect;
    if (mapped.project_id === null || mapped.connector_type === null) {
      if (mapped.delivery_id) {
        if (!fallbackByDeliveryId.has(mapped.delivery_id)) {
          const delivery = await getConnectorDelivery(mapped.delivery_id);
          fallbackByDeliveryId.set(mapped.delivery_id, {
            project_id: delivery?.project_id ?? null,
            connector_type: delivery?.connector_type ?? null,
          });
        }
        const fallback = fallbackByDeliveryId.get(mapped.delivery_id);
        if (fallback) {
          mapped = toConnectorActionTimelineEvent({ event, fallback }) ?? mapped;
        }
      }
    }

    if (mapped.project_id !== parsedQuery.data.projectId) {
      continue;
    }

    if (parsedQuery.data.connectorType && mapped.connector_type !== parsedQuery.data.connectorType) {
      continue;
    }

    timeline.push(mapped);
    if (timeline.length >= parsedQuery.data.limit) {
      break;
    }
  }

  const summary = summarizeConnectorActionTimeline(timeline);

  return NextResponse.json({
    project_id: parsedQuery.data.projectId,
    connector_type: parsedQuery.data.connectorType ?? null,
    limit: parsedQuery.data.limit,
    summary,
    events: timeline,
  });
}
