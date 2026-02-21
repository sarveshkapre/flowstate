import { NextResponse } from "next/server";
import { z } from "zod";

import { listConnectorDeliveries, listConnectorDeliveryAttempts } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { computeConnectorInsights } from "@/lib/v2/connector-insights";
import { connectorTypeSchema } from "@/lib/v2/request-security";

type Params = {
  params: Promise<{ type: string }>;
};

const querySchema = z.object({
  projectId: z.string().min(1),
  lookbackHours: z.coerce.number().int().positive().max(24 * 30).default(24),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

export async function GET(request: Request, { params }: Params) {
  const parsedType = connectorTypeSchema.safeParse((await params).type);

  if (!parsedType.success) {
    return NextResponse.json({ error: "Invalid connector type" }, { status: 400 });
  }

  const type = parsedType.data;
  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    projectId: url.searchParams.get("projectId"),
    lookbackHours: url.searchParams.get("lookbackHours") || undefined,
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

  const deliveries = await listConnectorDeliveries({
    projectId: parsedQuery.data.projectId,
    connectorType: type,
    limit: parsedQuery.data.limit,
  });

  const attemptsEntries = await Promise.all(
    deliveries.map(async (delivery) => {
      const attempts = await listConnectorDeliveryAttempts(delivery.id);
      return [delivery.id, attempts] as const;
    }),
  );

  const insights = computeConnectorInsights({
    deliveries,
    attemptsByDeliveryId: Object.fromEntries(attemptsEntries),
    lookbackHours: parsedQuery.data.lookbackHours,
  });

  return NextResponse.json({
    connector_type: type,
    project_id: parsedQuery.data.projectId,
    lookback_hours: parsedQuery.data.lookbackHours,
    insights,
  });
}
