import { NextResponse } from "next/server";
import { z } from "zod";

import { getConnectorBackpressurePolicy, getProject, summarizeConnectorDeliveries } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import {
  buildConnectorBackpressureCandidatePolicy,
  simulateConnectorBackpressurePolicy,
} from "@/lib/v2/connector-backpressure-simulation";
import { SUPPORTED_CONNECTOR_TYPES } from "@/lib/v2/connectors";
import { connectorTypeSchema } from "@/lib/v2/request-security";

type Params = {
  params: Promise<{ projectId: string }>;
};

const simulatePolicySchema = z.object({
  requestedLimit: z.coerce.number().int().positive().max(100).default(25),
  connectorTypes: z.array(connectorTypeSchema).min(1).max(20).optional(),
  isEnabled: z.boolean().optional(),
  maxRetrying: z.coerce.number().int().positive().max(10_000).optional(),
  maxDueNow: z.coerce.number().int().positive().max(10_000).optional(),
  minLimit: z.coerce.number().int().positive().max(100).optional(),
  connectorOverrides: z
    .record(
      z.string(),
      z.object({
        isEnabled: z.boolean().optional(),
        maxRetrying: z.coerce.number().int().positive().max(10_000).optional(),
        maxDueNow: z.coerce.number().int().positive().max(10_000).optional(),
        minLimit: z.coerce.number().int().positive().max(100).optional(),
      }),
    )
    .optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({
    request,
    permission: "manage_project",
    projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = simulatePolicySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const connectorTypes = parsed.data.connectorTypes ?? [...SUPPORTED_CONNECTOR_TYPES];
  const currentPolicy = await getConnectorBackpressurePolicy(projectId);
  const summaries = await Promise.all(
    connectorTypes.map(async (connectorType) => {
      const summary = await summarizeConnectorDeliveries({
        projectId,
        connectorType,
      });

      return [connectorType, summary] as const;
    }),
  );

  const candidatePolicy = buildConnectorBackpressureCandidatePolicy({
    projectId,
    basePolicy: currentPolicy,
    update: {
      enabled: parsed.data.isEnabled,
      maxRetrying: parsed.data.maxRetrying,
      maxDueNow: parsed.data.maxDueNow,
      minLimit: parsed.data.minLimit,
      byConnector: parsed.data.connectorOverrides,
    },
  });

  const simulation = simulateConnectorBackpressurePolicy({
    connectorTypes,
    requestedLimit: parsed.data.requestedLimit,
    summariesByConnector: Object.fromEntries(summaries),
    currentPolicy,
    candidatePolicy,
  });

  return NextResponse.json({
    project_id: projectId,
    current_policy: currentPolicy,
    candidate_policy: candidatePolicy,
    simulation,
  });
}
