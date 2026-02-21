import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listConnectorDeliveries,
  listConnectorDeliveryAttempts,
  summarizeConnectorDeliveries,
} from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { computeConnectorInsights } from "@/lib/v2/connector-insights";
import { rankConnectorReliability } from "@/lib/v2/connector-reliability";
import { canonicalConnectorType, SUPPORTED_CONNECTOR_TYPES } from "@/lib/v2/connectors";

const querySchema = z.object({
  projectId: z.string().min(1),
  lookbackHours: z.coerce.number().int().positive().max(24 * 30).default(24),
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
        lookbackHours: parsedQuery.data.lookbackHours,
      });

      return {
        connector_type: connectorType,
        summary,
        insights,
      };
    }),
  );

  const ranked = rankConnectorReliability(records);

  return NextResponse.json({
    project_id: parsedQuery.data.projectId,
    lookback_hours: parsedQuery.data.lookbackHours,
    connector_types: connectorTypes,
    generated_at: new Date().toISOString(),
    connectors: ranked,
  });
}
