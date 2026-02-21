import { NextResponse } from "next/server";
import { z } from "zod";

import { getReviewAlertPolicy, listReviewQueuesV2, processConnectorDelivery } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { evaluateReviewAlert, normalizeReviewAlertThresholds } from "@/lib/v2/review-alerts";
import { connectorTypeSchema } from "@/lib/v2/request-security";

const DEFAULT_ALERTS_CONFIG = {
  connectorType: "slack",
  staleHours: 24,
  queueLimit: 50,
  minUnreviewedQueues: 5,
  minAtRiskQueues: 3,
  minStaleQueues: 3,
  minAvgErrorRate: 0.35,
} as const;

const querySchema = z.object({
  projectId: z.string().min(1),
  staleHours: z.coerce.number().int().positive().max(24 * 30).optional(),
  queueLimit: z.coerce.number().int().positive().max(200).optional(),
  minUnreviewedQueues: z.coerce.number().int().nonnegative().max(500).optional(),
  minAtRiskQueues: z.coerce.number().int().nonnegative().max(500).optional(),
  minStaleQueues: z.coerce.number().int().nonnegative().max(500).optional(),
  minAvgErrorRate: z.coerce.number().min(0).max(1).optional(),
});

const dispatchSchema = querySchema.extend({
  connectorType: connectorTypeSchema.optional(),
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

type EffectiveAlertConfig = {
  connectorType: string;
  staleHours: number;
  queueLimit: number;
  thresholds: {
    minUnreviewedQueues: number;
    minAtRiskQueues: number;
    minStaleQueues: number;
    minAvgErrorRate: number;
  };
  policy: {
    id: string;
    is_enabled: boolean;
  } | null;
};

function resolveEffectiveAlertConfig(input: {
  policy: Awaited<ReturnType<typeof getReviewAlertPolicy>>;
  request: {
    connectorType?: string;
    staleHours?: number;
    queueLimit?: number;
    minUnreviewedQueues?: number;
    minAtRiskQueues?: number;
    minStaleQueues?: number;
    minAvgErrorRate?: number;
  };
}): EffectiveAlertConfig {
  const staleHours = input.request.staleHours ?? input.policy?.stale_hours ?? DEFAULT_ALERTS_CONFIG.staleHours;
  const queueLimit = input.request.queueLimit ?? input.policy?.queue_limit ?? DEFAULT_ALERTS_CONFIG.queueLimit;
  const connectorType = input.request.connectorType ?? input.policy?.connector_type ?? DEFAULT_ALERTS_CONFIG.connectorType;

  const thresholds = normalizeReviewAlertThresholds({
    minUnreviewedQueues:
      input.request.minUnreviewedQueues ??
      input.policy?.min_unreviewed_queues ??
      DEFAULT_ALERTS_CONFIG.minUnreviewedQueues,
    minAtRiskQueues: input.request.minAtRiskQueues ?? input.policy?.min_at_risk_queues ?? DEFAULT_ALERTS_CONFIG.minAtRiskQueues,
    minStaleQueues: input.request.minStaleQueues ?? input.policy?.min_stale_queues ?? DEFAULT_ALERTS_CONFIG.minStaleQueues,
    minAvgErrorRate:
      input.request.minAvgErrorRate ?? input.policy?.min_avg_error_rate ?? DEFAULT_ALERTS_CONFIG.minAvgErrorRate,
  });

  return {
    connectorType,
    staleHours,
    queueLimit,
    thresholds,
    policy: input.policy
      ? {
          id: input.policy.id,
          is_enabled: input.policy.is_enabled,
        }
      : null,
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

  const policy = await getReviewAlertPolicy(parsed.data.projectId);
  const effectiveConfig = resolveEffectiveAlertConfig({
    policy,
    request: parsed.data,
  });

  const queues = await listReviewQueuesV2({
    projectId: parsed.data.projectId,
    limit: effectiveConfig.queueLimit,
    staleAfterMs: effectiveConfig.staleHours * 60 * 60 * 1000,
  });

  const { thresholds, evaluation } = evaluatePayload({
    summary: queues.summary,
    thresholds: effectiveConfig.thresholds,
  });

  return NextResponse.json({
    project_id: parsed.data.projectId,
    stale_hours: effectiveConfig.staleHours,
    queue_limit: effectiveConfig.queueLimit,
    connector_type: effectiveConfig.connectorType,
    policy: effectiveConfig.policy,
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

  const policy = await getReviewAlertPolicy(parsed.data.projectId);
  const effectiveConfig = resolveEffectiveAlertConfig({
    policy,
    request: parsed.data,
  });

  const queues = await listReviewQueuesV2({
    projectId: parsed.data.projectId,
    limit: effectiveConfig.queueLimit,
    staleAfterMs: effectiveConfig.staleHours * 60 * 60 * 1000,
  });

  const { thresholds, evaluation } = evaluatePayload({
    summary: queues.summary,
    thresholds: effectiveConfig.thresholds,
  });

  if (!evaluation.should_alert) {
    return NextResponse.json({
      dispatched: false,
      reason: "Thresholds not met",
      policy: effectiveConfig.policy,
      thresholds,
      evaluation,
      summary: queues.summary,
    });
  }

  const result = await processConnectorDelivery({
    projectId: parsed.data.projectId,
    connectorType: effectiveConfig.connectorType,
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
    connector_type: effectiveConfig.connectorType,
    project_id: parsed.data.projectId,
    policy: effectiveConfig.policy,
    thresholds,
    evaluation,
    summary: queues.summary,
    delivery: result.delivery,
    attempts: result.attempts,
    duplicate: result.duplicate,
  });
}
