import { NextResponse } from "next/server";
import { z } from "zod";

import { getConnectorBackpressurePolicy, processConnectorDeliveryQueue, summarizeConnectorDeliveries } from "@/lib/data-store-v2";
import { resolveConnectorProcessBackpressure } from "@/lib/v2/connector-backpressure";
import { requirePermission } from "@/lib/v2/auth";
import { connectorTypeSchema } from "@/lib/v2/request-security";
import { SUPPORTED_CONNECTOR_TYPES } from "@/lib/v2/connectors";

const processAllSchema = z.object({
  projectId: z.string().min(1),
  limit: z.number().int().positive().max(100).default(10),
  connectorTypes: z.array(connectorTypeSchema).min(1).max(20).optional(),
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
  const policy = parsed.data.backpressure ? null : await getConnectorBackpressurePolicy(parsed.data.projectId);
  const effectiveBackpressureConfig = parsed.data.backpressure ?? (policy
    ? {
        enabled: policy.is_enabled,
        maxRetrying: policy.max_retrying,
        maxDueNow: policy.max_due_now,
        minLimit: policy.min_limit,
      }
    : undefined);
  const results: Array<{
    connector_type: string;
    requested_limit: number;
    effective_limit: number;
    throttled: boolean;
    throttle_reason: "retrying_limit" | "due_now_limit" | null;
    backpressure: ReturnType<typeof resolveConnectorProcessBackpressure>;
    processed_count: number;
    delivery_ids: string[];
  }> = [];
  let processedCount = 0;

  for (const connectorType of connectorTypes) {
    const summary = await summarizeConnectorDeliveries({
      projectId: parsed.data.projectId,
      connectorType,
    });
    const backpressure = resolveConnectorProcessBackpressure({
      requestedLimit: parsed.data.limit,
      summary,
      config: effectiveBackpressureConfig,
    });

    const result = await processConnectorDeliveryQueue({
      projectId: parsed.data.projectId,
      connectorType,
      limit: backpressure.effective_limit,
      actor: auth.actor.email ?? "api-key",
    });

    processedCount += result.processed_count;
    results.push({
      connector_type: connectorType,
      requested_limit: backpressure.requested_limit,
      effective_limit: backpressure.effective_limit,
      throttled: backpressure.throttled,
      throttle_reason: backpressure.reason,
      backpressure,
      processed_count: result.processed_count,
      delivery_ids: result.deliveries.map((delivery) => delivery.id),
    });
  }

  return NextResponse.json({
    project_id: parsed.data.projectId,
    connector_types: connectorTypes,
    requested_limit: parsed.data.limit,
    backpressure_enabled: effectiveBackpressureConfig?.enabled === true,
    policy_applied: parsed.data.backpressure === undefined && policy !== null,
    processed_count: processedCount,
    per_connector: results,
  });
}
