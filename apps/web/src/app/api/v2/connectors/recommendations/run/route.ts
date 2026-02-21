import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getConnectorBackpressurePolicy,
  getConnectorDelivery,
  listConnectorDeliveries,
  listConnectorDeliveryAttempts,
  listV2AuditEvents,
  processConnectorDeliveryQueue,
  redriveConnectorDeliveryBatch,
  summarizeConnectorDeliveries,
} from "@/lib/data-store-v2";
import { toConnectorActionTimelineEvent } from "@/lib/v2/connector-action-timeline";
import { requirePermission } from "@/lib/v2/auth";
import { resolveConnectorProcessBackpressure } from "@/lib/v2/connector-backpressure";
import { computeConnectorInsights } from "@/lib/v2/connector-insights";
import { rankConnectorReliability } from "@/lib/v2/connector-reliability";
import {
  filterConnectorRecommendationCooldown,
  selectConnectorRecommendationActions,
} from "@/lib/v2/connector-recommendations";
import { connectorTypeSchema } from "@/lib/v2/request-security";
import { SUPPORTED_CONNECTOR_TYPES } from "@/lib/v2/connectors";

const runRecommendationsSchema = z.object({
  projectId: z.string().min(1),
  lookbackHours: z.number().int().positive().max(24 * 30).default(24),
  connectorTypes: z.array(connectorTypeSchema).min(1).max(20).optional(),
  limit: z.number().int().positive().max(100).default(10),
  minDeadLetterMinutes: z.number().int().nonnegative().max(7 * 24 * 60).default(15),
  riskThreshold: z.number().positive().max(500).default(20),
  maxActions: z.number().int().positive().max(20).default(3),
  cooldownMinutes: z.number().int().nonnegative().max(24 * 60).default(0),
  allowProcessQueue: z.boolean().default(true),
  allowRedriveDeadLetters: z.boolean().default(true),
  dryRun: z.boolean().default(false),
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
  const parsed = runRecommendationsSchema.safeParse(payload);

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

  const connectorTypes = [...new Set(parsed.data.connectorTypes ?? [...SUPPORTED_CONNECTOR_TYPES])];
  const records = await Promise.all(
    connectorTypes.map(async (connectorType) => {
      const [summary, deliveries] = await Promise.all([
        summarizeConnectorDeliveries({
          projectId: parsed.data.projectId,
          connectorType,
        }),
        listConnectorDeliveries({
          projectId: parsed.data.projectId,
          connectorType,
          limit: 200,
        }),
      ]);

      const attemptsEntries = await Promise.all(
        deliveries.map(async (delivery) => {
          const attempts = await listConnectorDeliveryAttempts(delivery.id);
          return [delivery.id, attempts] as const;
        }),
      );

      const insights = computeConnectorInsights({
        deliveries,
        attemptsByDeliveryId: Object.fromEntries(attemptsEntries),
        lookbackHours: parsed.data.lookbackHours,
      });

      return {
        connector_type: connectorType,
        summary,
        insights,
      };
    }),
  );

  const ranked = rankConnectorReliability(records);
  const summaryByConnector = new Map<string, (typeof records)[number]["summary"]>(
    records.map((record) => [record.connector_type, record.summary]),
  );
  const selected = selectConnectorRecommendationActions({
    connectors: ranked,
    riskThreshold: parsed.data.riskThreshold,
    maxActions: parsed.data.maxActions,
    allowProcessQueue: parsed.data.allowProcessQueue,
    allowRedriveDeadLetters: parsed.data.allowRedriveDeadLetters,
  });

  const latestActionAtByConnector: Record<string, string | undefined> = {};
  if (parsed.data.cooldownMinutes > 0) {
    const recentAuditEvents = await listV2AuditEvents(1000);
    const fallbackByDeliveryId = new Map<string, { project_id: string | null; connector_type: string | null }>();

    for (const event of recentAuditEvents) {
      const mappedDirect = toConnectorActionTimelineEvent({ event });
      if (!mappedDirect) {
        continue;
      }

      let mapped = mappedDirect;
      if (mapped.project_id === null || mapped.connector_type === null) {
        if (mapped.delivery_id) {
          if (!fallbackByDeliveryId.has(mapped.delivery_id)) {
            const delivery = await getConnectorDelivery(mapped.delivery_id);
            fallbackByDeliveryId.set(mapped.delivery_id, {
              project_id: delivery?.project_id ?? null,
              connector_type: delivery?.connector_type ?? null,
            });
          }
          const fallback = fallbackByDeliveryId.get(mapped.delivery_id);
          if (fallback) {
            mapped = toConnectorActionTimelineEvent({ event, fallback }) ?? mapped;
          }
        }
      }

      if (mapped.project_id !== parsed.data.projectId || !mapped.connector_type) {
        continue;
      }

      const previous = latestActionAtByConnector[mapped.connector_type];
      if (!previous || Date.parse(mapped.created_at) > Date.parse(previous)) {
        latestActionAtByConnector[mapped.connector_type] = mapped.created_at;
      }
    }
  }

  const cooldownFiltered = filterConnectorRecommendationCooldown({
    actions: selected,
    latestActionAtByConnector,
    cooldownMinutes: parsed.data.cooldownMinutes,
  });
  const eligibleActions = cooldownFiltered.eligible;
  const skippedActions = cooldownFiltered.skipped;
  const policy = parsed.data.backpressure ? null : await getConnectorBackpressurePolicy(parsed.data.projectId);
  const effectiveBackpressureConfig = parsed.data.backpressure ?? (policy
    ? {
        enabled: policy.is_enabled,
        maxRetrying: policy.max_retrying,
        maxDueNow: policy.max_due_now,
        minLimit: policy.min_limit,
      }
    : undefined);

  const actionResults: Array<{
    connector_type: string;
    recommendation: "process_queue" | "redrive_dead_letters";
    risk_score: number;
    requested_process_limit: number;
    effective_process_limit: number;
    process_throttled: boolean;
    process_throttle_reason: "retrying_limit" | "due_now_limit" | null;
    processed_count: number;
    redriven_count: number;
    delivery_ids: string[];
  }> = [];

  if (!parsed.data.dryRun) {
    const actor = auth.actor.email ?? "api-key";
    for (const action of eligibleActions) {
      if (action.recommendation === "process_queue") {
        const currentSummary = summaryByConnector.get(action.connector_type) ?? {
          queued: 0,
          retrying: 0,
          due_now: 0,
        };
        const processBackpressure = resolveConnectorProcessBackpressure({
          requestedLimit: parsed.data.limit,
          summary: currentSummary,
          config: effectiveBackpressureConfig,
        });
        const process = await processConnectorDeliveryQueue({
          projectId: parsed.data.projectId,
          connectorType: action.connector_type,
          limit: processBackpressure.effective_limit,
          actor,
        });

        actionResults.push({
          connector_type: action.connector_type,
          recommendation: action.recommendation,
          risk_score: action.risk_score,
          requested_process_limit: processBackpressure.requested_limit,
          effective_process_limit: processBackpressure.effective_limit,
          process_throttled: processBackpressure.throttled,
          process_throttle_reason: processBackpressure.reason,
          processed_count: process.processed_count,
          redriven_count: 0,
          delivery_ids: process.deliveries.map((delivery) => delivery.id),
        });
        continue;
      }

      const redrive = await redriveConnectorDeliveryBatch({
        projectId: parsed.data.projectId,
        connectorType: action.connector_type,
        limit: parsed.data.limit,
        minDeadLetterMinutes: parsed.data.minDeadLetterMinutes,
        actor,
      });

      let processedCount = 0;
      let processBackpressure = null as ReturnType<typeof resolveConnectorProcessBackpressure> | null;
      if (redrive.redriven_count > 0) {
        const processSummary = await summarizeConnectorDeliveries({
          projectId: parsed.data.projectId,
          connectorType: action.connector_type,
        });
        processBackpressure = resolveConnectorProcessBackpressure({
          requestedLimit: redrive.redriven_count,
          summary: processSummary,
          config: effectiveBackpressureConfig,
        });
        const process = await processConnectorDeliveryQueue({
          projectId: parsed.data.projectId,
          connectorType: action.connector_type,
          limit: processBackpressure.effective_limit,
          actor,
        });
        processedCount = process.processed_count;
      }

      actionResults.push({
        connector_type: action.connector_type,
        recommendation: action.recommendation,
        risk_score: action.risk_score,
        requested_process_limit: processBackpressure?.requested_limit ?? 0,
        effective_process_limit: processBackpressure?.effective_limit ?? 0,
        process_throttled: processBackpressure?.throttled ?? false,
        process_throttle_reason: processBackpressure?.reason ?? null,
        processed_count: processedCount,
        redriven_count: redrive.redriven_count,
        delivery_ids: redrive.deliveries.map((delivery) => delivery.id),
      });
    }
  }

  return NextResponse.json({
    project_id: parsed.data.projectId,
    lookback_hours: parsed.data.lookbackHours,
    connector_types: connectorTypes,
    risk_threshold: parsed.data.riskThreshold,
    max_actions: parsed.data.maxActions,
    cooldown_minutes: parsed.data.cooldownMinutes,
    dry_run: parsed.data.dryRun,
    backpressure_enabled: effectiveBackpressureConfig?.enabled === true,
    policy_applied: parsed.data.backpressure === undefined && policy !== null,
    selected_actions: eligibleActions,
    skipped_actions: skippedActions,
    action_results: actionResults,
  });
}
