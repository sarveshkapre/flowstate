import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getConnectorBackpressurePolicy,
  processConnectorDeliveryQueue,
  redriveConnectorDeliveryBatch,
  summarizeConnectorDeliveries,
} from "@/lib/data-store-v2";
import { resolveConnectorBackpressureConfig } from "@/lib/v2/connector-backpressure-policy";
import { resolveConnectorProcessBackpressure } from "@/lib/v2/connector-backpressure";
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
  backpressure: z
    .object({
      enabled: z.boolean().default(false),
      maxRetrying: z.number().int().positive().max(10_000).optional(),
      maxDueNow: z.number().int().positive().max(10_000).optional(),
      minLimit: z.number().int().positive().max(100).default(1),
      byConnector: z
        .record(
          z.string(),
          z.object({
            enabled: z.boolean().optional(),
            maxRetrying: z.number().int().positive().max(10_000).optional(),
            maxDueNow: z.number().int().positive().max(10_000).optional(),
            minLimit: z.number().int().positive().max(100).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
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
  const policy = parsed.data.backpressure ? null : await getConnectorBackpressurePolicy(parsed.data.projectId);
  const connectorTypes = [...new Set(parsed.data.connectorTypes ?? [...SUPPORTED_CONNECTOR_TYPES])];
  let redrivenCount = 0;
  let processedCount = 0;
  let skippedCount = 0;
  let throttledCount = 0;

  const results: Array<{
    connector_type: string;
    backpressure_source: string;
    dead_lettered: number;
    redriven_count: number;
    requested_process_limit: number;
    effective_process_limit: number;
    throttled: boolean;
    throttle_reason: "retrying_limit" | "due_now_limit" | null;
    backpressure: ReturnType<typeof resolveConnectorProcessBackpressure> | null;
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
        backpressure_source: "none",
        dead_lettered: deadLettered,
        redriven_count: 0,
        requested_process_limit: 0,
        effective_process_limit: 0,
        throttled: false,
        throttle_reason: null,
        backpressure: null,
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
    let processBackpressure: ReturnType<typeof resolveConnectorProcessBackpressure> | null = null;
    const resolvedBackpressureConfig = resolveConnectorBackpressureConfig({
      connectorType,
      requestBackpressure: parsed.data.backpressure,
      policy,
    });
    if (parsed.data.processAfterRedrive && redriveResult.redriven_count > 0) {
      const processSummary = await summarizeConnectorDeliveries({
        projectId: parsed.data.projectId,
        connectorType,
      });
      processBackpressure = resolveConnectorProcessBackpressure({
        requestedLimit: redriveResult.redriven_count,
        summary: processSummary,
        config: resolvedBackpressureConfig.config,
      });

      const processResult = await processConnectorDeliveryQueue({
        projectId: parsed.data.projectId,
        connectorType,
        limit: processBackpressure.effective_limit,
        actor,
      });
      connectorProcessedCount = processResult.processed_count;
      processedCount += connectorProcessedCount;
      if (processBackpressure.throttled) {
        throttledCount += 1;
      }
    }

    if (redriveResult.redriven_count <= 0) {
      skippedCount += 1;
    }

    results.push({
      connector_type: connectorType,
      backpressure_source: resolvedBackpressureConfig.source,
      dead_lettered: deadLettered,
      redriven_count: redriveResult.redriven_count,
      requested_process_limit: processBackpressure?.requested_limit ?? 0,
      effective_process_limit: processBackpressure?.effective_limit ?? 0,
      throttled: processBackpressure?.throttled ?? false,
      throttle_reason: processBackpressure?.reason ?? null,
      backpressure: processBackpressure,
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
    backpressure_enabled: parsed.data.backpressure ? parsed.data.backpressure.enabled === true : policy?.is_enabled === true,
    policy_applied: parsed.data.backpressure === undefined && policy !== null,
    redriven_count: redrivenCount,
    processed_count: processedCount,
    skipped_count: skippedCount,
    throttled_count: throttledCount,
    per_connector: results,
  });
}
