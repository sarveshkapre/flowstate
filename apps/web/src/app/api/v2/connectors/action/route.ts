import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getConnectorBackpressurePolicy,
  processConnectorDeliveryQueue,
  redriveConnectorDeliveryBatch,
  summarizeConnectorDeliveries,
} from "@/lib/data-store-v2";
import { resolveConnectorProcessBackpressure } from "@/lib/v2/connector-backpressure";
import { requirePermission } from "@/lib/v2/auth";
import { connectorTypeSchema } from "@/lib/v2/request-security";

const actionSchema = z.object({
  projectId: z.string().min(1),
  connectorType: connectorTypeSchema,
  action: z.enum(["process_queue", "redrive_dead_letters"]),
  limit: z.number().int().positive().max(100).default(10),
  minDeadLetterMinutes: z.number().int().nonnegative().max(7 * 24 * 60).default(15),
  processAfterRedrive: z.boolean().default(true),
  backpressure: z
    .object({
      enabled: z.boolean().default(false),
      maxRetrying: z.number().int().positive().max(10_000).optional(),
      maxDueNow: z.number().int().positive().max(10_000).optional(),
      minLimit: z.number().int().positive().max(100).default(1),
    })
    .optional(),
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
  const policy = parsed.data.backpressure ? null : await getConnectorBackpressurePolicy(parsed.data.projectId);
  const effectiveBackpressureConfig = parsed.data.backpressure ?? (policy
    ? {
        enabled: policy.is_enabled,
        maxRetrying: policy.max_retrying,
        maxDueNow: policy.max_due_now,
        minLimit: policy.min_limit,
      }
    : undefined);

  if (parsed.data.action === "process_queue") {
    const summary = await summarizeConnectorDeliveries({
      projectId: parsed.data.projectId,
      connectorType: parsed.data.connectorType,
    });
    const backpressure = resolveConnectorProcessBackpressure({
      requestedLimit: parsed.data.limit,
      summary,
      config: effectiveBackpressureConfig,
    });

    const result = await processConnectorDeliveryQueue({
      projectId: parsed.data.projectId,
      connectorType: parsed.data.connectorType,
      limit: backpressure.effective_limit,
      actor,
    });

    return NextResponse.json({
      project_id: parsed.data.projectId,
      connector_type: parsed.data.connectorType,
      action: parsed.data.action,
      requested_limit: backpressure.requested_limit,
      effective_limit: backpressure.effective_limit,
      throttled: backpressure.throttled,
      throttle_reason: backpressure.reason,
      policy_applied: parsed.data.backpressure === undefined && policy !== null,
      backpressure,
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
  let processBackpressure: ReturnType<typeof resolveConnectorProcessBackpressure> | null = null;
  if (parsed.data.processAfterRedrive && redrive.redriven_count > 0) {
    const summary = await summarizeConnectorDeliveries({
      projectId: parsed.data.projectId,
      connectorType: parsed.data.connectorType,
    });
    processBackpressure = resolveConnectorProcessBackpressure({
      requestedLimit: redrive.redriven_count,
      summary,
      config: effectiveBackpressureConfig,
    });

    const processed = await processConnectorDeliveryQueue({
      projectId: parsed.data.projectId,
      connectorType: parsed.data.connectorType,
      limit: processBackpressure.effective_limit,
      actor,
    });
    processedCount = processed.processed_count;
  }

  return NextResponse.json({
    project_id: parsed.data.projectId,
    connector_type: parsed.data.connectorType,
    action: parsed.data.action,
    redriven_count: redrive.redriven_count,
    requested_process_limit: processBackpressure?.requested_limit ?? 0,
    effective_process_limit: processBackpressure?.effective_limit ?? 0,
    process_throttled: processBackpressure?.throttled ?? false,
    process_throttle_reason: processBackpressure?.reason ?? null,
    policy_applied: parsed.data.backpressure === undefined && policy !== null,
    process_backpressure: processBackpressure,
    processed_count: processedCount,
    delivery_ids: redrive.deliveries.map((delivery) => delivery.id),
  });
}
