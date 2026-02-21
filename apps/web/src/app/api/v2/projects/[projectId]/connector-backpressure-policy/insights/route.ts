import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getConnectorBackpressurePolicy,
  getProject,
  listConnectorDeliveries,
  listV2AuditEvents,
} from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import {
  summarizeConnectorBackpressureOutcomes,
  toConnectorBackpressurePolicyUpdate,
} from "@/lib/v2/connector-backpressure-insights";

type Params = {
  params: Promise<{ projectId: string }>;
};

const querySchema = z.object({
  lookbackHours: z.coerce.number().int().positive().max(24 * 30).default(24),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    lookbackHours: url.searchParams.get("lookbackHours") || undefined,
    limit: url.searchParams.get("limit") || undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json({ error: "Invalid query params", details: parsedQuery.error.flatten() }, { status: 400 });
  }

  const [policy, deliveries, auditEvents] = await Promise.all([
    getConnectorBackpressurePolicy(projectId),
    listConnectorDeliveries({
      projectId,
      limit: 500,
    }),
    listV2AuditEvents(Math.max(parsedQuery.data.limit * 20, 500)),
  ]);

  const updates = auditEvents
    .filter((event) => {
      const metadata = event.metadata;
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return false;
      }
      return (metadata as { project_id?: unknown }).project_id === projectId;
    })
    .map((event) => toConnectorBackpressurePolicyUpdate(event))
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, parsedQuery.data.limit);

  const outcomes = summarizeConnectorBackpressureOutcomes({
    deliveries,
    lookbackHours: parsedQuery.data.lookbackHours,
  });

  return NextResponse.json({
    project_id: projectId,
    lookback_hours: parsedQuery.data.lookbackHours,
    limit: parsedQuery.data.limit,
    policy,
    updates,
    update_count: updates.length,
    outcomes,
  });
}
