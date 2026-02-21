import { NextResponse } from "next/server";
import { z } from "zod";

import {
  processConnectorDeliveryQueue,
  redriveConnectorDeliveryBatch,
  summarizeConnectorDeliveries,
} from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { SUPPORTED_CONNECTOR_TYPES } from "@/lib/v2/connectors";
import { connectorTypeSchema } from "@/lib/v2/request-security";

const processAllSchema = z.object({
  projectId: z.string().min(1),
  limit: z.number().int().positive().max(100).default(10),
  connectorTypes: z.array(connectorTypeSchema).min(1).max(20).optional(),
  minDeadLetterMinutes: z.number().int().nonnegative().max(7 * 24 * 60).default(0),
  minDeadLetterCount: z.number().int().nonnegative().max(500).default(0),
  processAfterRedrive: z.boolean().default(false),
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

  const actor = auth.actor.email ?? "api-key";
  const connectorTypes = [...new Set(parsed.data.connectorTypes ?? [...SUPPORTED_CONNECTOR_TYPES])];
  let redrivenCount = 0;
  let processedCount = 0;
  let skippedCount = 0;

  const results: Array<{
    connector_type: string;
    dead_lettered: number;
    redriven_count: number;
    processed_count: number;
    skipped: boolean;
    delivery_ids: string[];
  }> = [];

  for (const connectorType of connectorTypes) {
    const summary = await summarizeConnectorDeliveries({
      projectId: parsed.data.projectId,
      connectorType,
    });
    const deadLettered = summary.dead_lettered;

    if (deadLettered < parsed.data.minDeadLetterCount) {
      skippedCount += 1;
      results.push({
        connector_type: connectorType,
        dead_lettered: deadLettered,
        redriven_count: 0,
        processed_count: 0,
        skipped: true,
        delivery_ids: [],
      });
      continue;
    }

    const redriveResult = await redriveConnectorDeliveryBatch({
      projectId: parsed.data.projectId,
      connectorType,
      limit: parsed.data.limit,
      minDeadLetterMinutes: parsed.data.minDeadLetterMinutes,
      actor,
    });

    redrivenCount += redriveResult.redriven_count;

    let connectorProcessedCount = 0;
    if (parsed.data.processAfterRedrive && redriveResult.redriven_count > 0) {
      const processResult = await processConnectorDeliveryQueue({
        projectId: parsed.data.projectId,
        connectorType,
        limit: redriveResult.redriven_count,
        actor,
      });
      connectorProcessedCount = processResult.processed_count;
      processedCount += connectorProcessedCount;
    }

    if (redriveResult.redriven_count <= 0) {
      skippedCount += 1;
    }

    results.push({
      connector_type: connectorType,
      dead_lettered: deadLettered,
      redriven_count: redriveResult.redriven_count,
      processed_count: connectorProcessedCount,
      skipped: redriveResult.redriven_count <= 0,
      delivery_ids: redriveResult.deliveries.map((delivery) => delivery.id),
    });
  }

  return NextResponse.json({
    project_id: parsed.data.projectId,
    connector_types: connectorTypes,
    min_dead_letter_count: parsed.data.minDeadLetterCount,
    min_dead_letter_minutes: parsed.data.minDeadLetterMinutes,
    process_after_redrive: parsed.data.processAfterRedrive,
    redriven_count: redrivenCount,
    processed_count: processedCount,
    skipped_count: skippedCount,
    per_connector: results,
  });
}
