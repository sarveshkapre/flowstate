import { NextResponse } from "next/server";
import { z } from "zod";

import { processConnectorDeliveryQueue, redriveConnectorDeliveryBatch } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { connectorTypeSchema } from "@/lib/v2/request-security";

const actionSchema = z.object({
  projectId: z.string().min(1),
  connectorType: connectorTypeSchema,
  action: z.enum(["process_queue", "redrive_dead_letters"]),
  limit: z.number().int().positive().max(100).default(10),
  minDeadLetterMinutes: z.number().int().nonnegative().max(7 * 24 * 60).default(15),
  processAfterRedrive: z.boolean().default(true),
});

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(payload);

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

  const actor = auth.actor.email ?? "api-key";

  if (parsed.data.action === "process_queue") {
    const result = await processConnectorDeliveryQueue({
      projectId: parsed.data.projectId,
      connectorType: parsed.data.connectorType,
      limit: parsed.data.limit,
      actor,
    });

    return NextResponse.json({
      project_id: parsed.data.projectId,
      connector_type: parsed.data.connectorType,
      action: parsed.data.action,
      processed_count: result.processed_count,
      delivery_ids: result.deliveries.map((delivery) => delivery.id),
    });
  }

  const redrive = await redriveConnectorDeliveryBatch({
    projectId: parsed.data.projectId,
    connectorType: parsed.data.connectorType,
    limit: parsed.data.limit,
    minDeadLetterMinutes: parsed.data.minDeadLetterMinutes,
    actor,
  });

  let processedCount = 0;
  if (parsed.data.processAfterRedrive && redrive.redriven_count > 0) {
    const processed = await processConnectorDeliveryQueue({
      projectId: parsed.data.projectId,
      connectorType: parsed.data.connectorType,
      limit: redrive.redriven_count,
      actor,
    });
    processedCount = processed.processed_count;
  }

  return NextResponse.json({
    project_id: parsed.data.projectId,
    connector_type: parsed.data.connectorType,
    action: parsed.data.action,
    redriven_count: redrive.redriven_count,
    processed_count: processedCount,
    delivery_ids: redrive.deliveries.map((delivery) => delivery.id),
  });
}
