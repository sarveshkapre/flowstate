import { NextResponse } from "next/server";
import { z } from "zod";

import { getConnectorGuardianPolicy, getProject, upsertConnectorGuardianPolicy } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ projectId: string }>;
};

const updatePolicySchema = z
  .object({
    isEnabled: z.boolean().optional(),
    lookbackHours: z.coerce.number().int().positive().max(24 * 30).optional(),
    riskThreshold: z.coerce.number().positive().max(500).optional(),
    maxActionsPerProject: z.coerce.number().int().positive().max(20).optional(),
    actionLimit: z.coerce.number().int().positive().max(100).optional(),
    cooldownMinutes: z.coerce.number().int().nonnegative().max(24 * 60).optional(),
    minDeadLetterMinutes: z.coerce.number().int().nonnegative().max(7 * 24 * 60).optional(),
    allowProcessQueue: z.boolean().optional(),
    allowRedriveDeadLetters: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
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

  const policy = await getConnectorGuardianPolicy(projectId);
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
    const policy = await upsertConnectorGuardianPolicy({
      projectId,
      isEnabled: parsed.data.isEnabled,
      lookbackHours: parsed.data.lookbackHours,
      riskThreshold: parsed.data.riskThreshold,
      maxActionsPerProject: parsed.data.maxActionsPerProject,
      actionLimit: parsed.data.actionLimit,
      cooldownMinutes: parsed.data.cooldownMinutes,
      minDeadLetterMinutes: parsed.data.minDeadLetterMinutes,
      allowProcessQueue: parsed.data.allowProcessQueue,
      allowRedriveDeadLetters: parsed.data.allowRedriveDeadLetters,
      actor: auth.actor.email ?? "api-key",
    });

    return NextResponse.json({ policy });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update connector guardian policy";
    const status = message === "Project not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
