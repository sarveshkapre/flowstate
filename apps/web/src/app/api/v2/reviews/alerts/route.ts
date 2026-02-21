import { NextResponse } from "next/server";
import { z } from "zod";

import { listReviewQueuesV2, processConnectorDelivery } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { evaluateReviewAlert, normalizeReviewAlertThresholds } from "@/lib/v2/review-alerts";
import { connectorTypeSchema } from "@/lib/v2/request-security";

const querySchema = z.object({
  projectId: z.string().min(1),
  staleHours: z.coerce.number().int().positive().max(24 * 30).default(24),
  queueLimit: z.coerce.number().int().positive().max(200).default(50),
  minUnreviewedQueues: z.coerce.number().int().nonnegative().max(500).default(5),
  minAtRiskQueues: z.coerce.number().int().nonnegative().max(500).default(3),
  minStaleQueues: z.coerce.number().int().nonnegative().max(500).default(3),
  minAvgErrorRate: z.coerce.number().min(0).max(1).default(0.35),
});

const dispatchSchema = querySchema.extend({
  connectorType: connectorTypeSchema.default("slack"),
  connectorConfig: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(1).optional(),
});

type ReviewSummaryShape = {
  unreviewed_queues: number;
  at_risk_queues: number;
  stale_queues: number;
  avg_error_rate: number;
};

function evaluatePayload(input: {
  summary: ReviewSummaryShape;
  thresholds: {
    minUnreviewedQueues: number;
    minAtRiskQueues: number;
    minStaleQueues: number;
    minAvgErrorRate: number;
  };
}) {
  const normalizedThresholds = normalizeReviewAlertThresholds(input.thresholds);
  const evaluation = evaluateReviewAlert({
    summary: input.summary,
    thresholds: normalizedThresholds,
  });

  return {
    thresholds: normalizedThresholds,
    evaluation,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    projectId: url.searchParams.get("projectId"),
    staleHours: url.searchParams.get("staleHours") || undefined,
    queueLimit: url.searchParams.get("queueLimit") || undefined,
    minUnreviewedQueues: url.searchParams.get("minUnreviewedQueues") || undefined,
    minAtRiskQueues: url.searchParams.get("minAtRiskQueues") || undefined,
    minStaleQueues: url.searchParams.get("minStaleQueues") || undefined,
    minAvgErrorRate: url.searchParams.get("minAvgErrorRate") || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query params", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: parsed.data.projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const queues = await listReviewQueuesV2({
    projectId: parsed.data.projectId,
    limit: parsed.data.queueLimit,
    staleAfterMs: parsed.data.staleHours * 60 * 60 * 1000,
  });

  const { thresholds, evaluation } = evaluatePayload({
    summary: queues.summary,
    thresholds: {
      minUnreviewedQueues: parsed.data.minUnreviewedQueues,
      minAtRiskQueues: parsed.data.minAtRiskQueues,
      minStaleQueues: parsed.data.minStaleQueues,
      minAvgErrorRate: parsed.data.minAvgErrorRate,
    },
  });

  return NextResponse.json({
    project_id: parsed.data.projectId,
    stale_hours: parsed.data.staleHours,
    queue_limit: parsed.data.queueLimit,
    thresholds,
    evaluation,
    summary: queues.summary,
    top_queues: queues.queues.slice(0, 5),
  });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = dispatchSchema.safeParse(payload);

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

  const queues = await listReviewQueuesV2({
    projectId: parsed.data.projectId,
    limit: parsed.data.queueLimit,
    staleAfterMs: parsed.data.staleHours * 60 * 60 * 1000,
  });

  const { thresholds, evaluation } = evaluatePayload({
    summary: queues.summary,
    thresholds: {
      minUnreviewedQueues: parsed.data.minUnreviewedQueues,
      minAtRiskQueues: parsed.data.minAtRiskQueues,
      minStaleQueues: parsed.data.minStaleQueues,
      minAvgErrorRate: parsed.data.minAvgErrorRate,
    },
  });

  if (!evaluation.should_alert) {
    return NextResponse.json({
      dispatched: false,
      reason: "Thresholds not met",
      thresholds,
      evaluation,
      summary: queues.summary,
    });
  }

  const result = await processConnectorDelivery({
    projectId: parsed.data.projectId,
    connectorType: parsed.data.connectorType,
    mode: "enqueue",
    config: parsed.data.connectorConfig,
    idempotencyKey: parsed.data.idempotencyKey,
    payload: {
      event: "review.ops.alert.manual",
      projectId: parsed.data.projectId,
      generated_at: new Date().toISOString(),
      summary: queues.summary,
      reasons: evaluation.reasons,
      top_queues: queues.queues.slice(0, 5),
    },
    actor: auth.actor.email ?? "api-key",
  });

  return NextResponse.json({
    dispatched: true,
    connector_type: parsed.data.connectorType,
    project_id: parsed.data.projectId,
    thresholds,
    evaluation,
    summary: queues.summary,
    delivery: result.delivery,
    attempts: result.attempts,
    duplicate: result.duplicate,
  });
}
