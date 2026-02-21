import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listConnectorDeliveries,
  listConnectorDeliveryAttempts,
  summarizeConnectorDeliveries,
} from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { computeConnectorInsights } from "@/lib/v2/connector-insights";
import { rankConnectorReliability, resolveConnectorReliabilityTrend } from "@/lib/v2/connector-reliability";
import { canonicalConnectorType, SUPPORTED_CONNECTOR_TYPES } from "@/lib/v2/connectors";

const querySchema = z.object({
  projectId: z.string().min(1),
  lookbackHours: z.coerce.number().int().positive().max(24 * 30).default(24),
  trendLookbackHours: z.coerce.number().int().positive().max(24 * 30).optional(),
  includeTrend: z.coerce.boolean().default(true),
  limit: z.coerce.number().int().positive().max(500).default(200),
  connectorTypes: z.string().optional(),
});

function parseConnectorTypes(raw: string | undefined) {
  if (!raw || raw.trim().length === 0) {
    return [...SUPPORTED_CONNECTOR_TYPES];
  }

  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const normalized = [...new Set(items)];
  const parsed = normalized.map((item) => canonicalConnectorType(item));

  if (parsed.some((item) => item === null)) {
    return null;
  }

  return [...new Set(parsed)] as (typeof SUPPORTED_CONNECTOR_TYPES)[number][];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    projectId: url.searchParams.get("projectId"),
    lookbackHours: url.searchParams.get("lookbackHours") || undefined,
    trendLookbackHours: url.searchParams.get("trendLookbackHours") || undefined,
    includeTrend: url.searchParams.get("includeTrend") || undefined,
    limit: url.searchParams.get("limit") || undefined,
    connectorTypes: url.searchParams.get("connectorTypes") || undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json({ error: "Invalid query params", details: parsedQuery.error.flatten() }, { status: 400 });
  }

  const connectorTypes = parseConnectorTypes(parsedQuery.data.connectorTypes);
  if (!connectorTypes) {
    return NextResponse.json({ error: "Invalid connectorTypes list" }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: parsedQuery.data.projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const nowMs = Date.now();
  const currentLookbackHours = parsedQuery.data.lookbackHours;
  const trendLookbackHours = parsedQuery.data.trendLookbackHours ?? currentLookbackHours;
  const trendReferenceMs = nowMs - currentLookbackHours * 60 * 60 * 1000;

  const records = await Promise.all(
    connectorTypes.map(async (connectorType) => {
      const [summary, deliveries] = await Promise.all([
        summarizeConnectorDeliveries({
          projectId: parsedQuery.data.projectId,
          connectorType,
        }),
        listConnectorDeliveries({
          projectId: parsedQuery.data.projectId,
          connectorType,
          limit: parsedQuery.data.limit,
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
        lookbackHours: currentLookbackHours,
        nowMs,
      });

      const baselineInsights = parsedQuery.data.includeTrend
        ? computeConnectorInsights({
            deliveries,
            attemptsByDeliveryId: Object.fromEntries(attemptsEntries),
            lookbackHours: trendLookbackHours,
            nowMs: trendReferenceMs,
          })
        : null;

      return {
        connector_type: connectorType,
        summary,
        insights,
        baseline_insights: baselineInsights,
      };
    }),
  );

  const ranked = rankConnectorReliability(
    records.map((record) => ({
      connector_type: record.connector_type,
      summary: record.summary,
      insights: record.insights,
    })),
  );

  let connectors = ranked;
  if (parsedQuery.data.includeTrend) {
    const rankedBaseline = rankConnectorReliability(
      records.map((record) => ({
        connector_type: record.connector_type,
        summary: record.summary,
        insights: record.baseline_insights ?? record.insights,
      })),
    );
    const baselineByConnector = new Map<string, number>(
      rankedBaseline.map((item) => [item.connector_type, item.risk_score] as const),
    );
    connectors = ranked.map((item) => ({
      ...item,
      ...resolveConnectorReliabilityTrend({
        riskScore: item.risk_score,
        baselineRiskScore: baselineByConnector.get(item.connector_type) ?? 0,
      }),
    }));
  }

  return NextResponse.json({
    project_id: parsedQuery.data.projectId,
    lookback_hours: currentLookbackHours,
    trend_lookback_hours: parsedQuery.data.includeTrend ? trendLookbackHours : null,
    include_trend: parsedQuery.data.includeTrend,
    connector_types: connectorTypes,
    generated_at: new Date().toISOString(),
    connectors,
  });
}
