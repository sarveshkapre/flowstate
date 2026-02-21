import { NextResponse } from "next/server";
import { z } from "zod";

import { getProject, getReviewAlertPolicy, upsertReviewAlertPolicy } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { connectorTypeSchema } from "@/lib/v2/request-security";

type Params = {
  params: Promise<{ projectId: string }>;
};

const updatePolicySchema = z.object({
  isEnabled: z.boolean().optional(),
  connectorType: connectorTypeSchema.optional(),
  staleHours: z.coerce.number().int().positive().max(24 * 30).optional(),
  queueLimit: z.coerce.number().int().positive().max(200).optional(),
  minUnreviewedQueues: z.coerce.number().int().nonnegative().max(500).optional(),
  minAtRiskQueues: z.coerce.number().int().nonnegative().max(500).optional(),
  minStaleQueues: z.coerce.number().int().nonnegative().max(500).optional(),
  minAvgErrorRate: z.coerce.number().min(0).max(1).optional(),
  idempotencyWindowMinutes: z.coerce.number().int().positive().max(24 * 60).optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), {
  message: "At least one policy field is required",
});

export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const policy = await getReviewAlertPolicy(projectId);
  return NextResponse.json({ policy });
}

export async function PUT(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({
    request,
    permission: "manage_project",
    projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = updatePolicySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const policy = await upsertReviewAlertPolicy({
      projectId,
      isEnabled: parsed.data.isEnabled,
      connectorType: parsed.data.connectorType,
      staleHours: parsed.data.staleHours,
      queueLimit: parsed.data.queueLimit,
      minUnreviewedQueues: parsed.data.minUnreviewedQueues,
      minAtRiskQueues: parsed.data.minAtRiskQueues,
      minStaleQueues: parsed.data.minStaleQueues,
      minAvgErrorRate: parsed.data.minAvgErrorRate,
      idempotencyWindowMinutes: parsed.data.idempotencyWindowMinutes,
      actor: auth.actor.email ?? "api-key",
    });

    return NextResponse.json({ policy });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update review alert policy";
    const status = message === "Project not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
