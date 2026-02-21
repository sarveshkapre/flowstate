import { NextResponse } from "next/server";
import { z } from "zod";

import { summarizeConnectorDeliveries } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { SUPPORTED_CONNECTOR_TYPES } from "@/lib/v2/connectors";
import { connectorTypeSchema } from "@/lib/v2/request-security";
import { suggestConnectorBackpressureSettings } from "@/lib/v2/connector-backpressure-tuning";

const recommendBackpressureSchema = z.object({
  projectId: z.string().min(1),
  connectorTypes: z.array(connectorTypeSchema).min(1).max(20).optional(),
});

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = recommendBackpressureSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: parsed.data.projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const connectorTypes = [...new Set(parsed.data.connectorTypes ?? [...SUPPORTED_CONNECTOR_TYPES])];
  const summaries = await Promise.all(
    connectorTypes.map(async (connectorType) => {
      const summary = await summarizeConnectorDeliveries({
        projectId: parsed.data.projectId,
        connectorType,
      });

      return {
        connectorType,
        summary: {
          queued: summary.queued,
          retrying: summary.retrying,
          due_now: summary.due_now,
        },
      };
    }),
  );
  const suggestions = suggestConnectorBackpressureSettings({ summaries });

  return NextResponse.json({
    project_id: parsed.data.projectId,
    connector_types: connectorTypes,
    generated_at: new Date().toISOString(),
    recommendation: suggestions.recommendation,
    by_connector: suggestions.by_connector,
  });
}
