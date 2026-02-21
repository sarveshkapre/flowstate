import { NextResponse } from "next/server";
import { z } from "zod";

import { processConnectorDeliveryQueue } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { connectorTypeSchema } from "@/lib/v2/request-security";
import { SUPPORTED_CONNECTOR_TYPES } from "@/lib/v2/connectors";

const processAllSchema = z.object({
  projectId: z.string().min(1),
  limit: z.number().int().positive().max(100).default(10),
  connectorTypes: z.array(connectorTypeSchema).min(1).max(20).optional(),
});

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = processAllSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: "run_flow",
    projectId: parsed.data.projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const connectorTypes = parsed.data.connectorTypes ?? [...SUPPORTED_CONNECTOR_TYPES];
  const results: Array<{
    connector_type: string;
    processed_count: number;
    delivery_ids: string[];
  }> = [];
  let processedCount = 0;

  for (const connectorType of connectorTypes) {
    const result = await processConnectorDeliveryQueue({
      projectId: parsed.data.projectId,
      connectorType,
      limit: parsed.data.limit,
      actor: auth.actor.email ?? "api-key",
    });

    processedCount += result.processed_count;
    results.push({
      connector_type: connectorType,
      processed_count: result.processed_count,
      delivery_ids: result.deliveries.map((delivery) => delivery.id),
    });
  }

  return NextResponse.json({
    project_id: parsed.data.projectId,
    connector_types: connectorTypes,
    processed_count: processedCount,
    per_connector: results,
  });
}
