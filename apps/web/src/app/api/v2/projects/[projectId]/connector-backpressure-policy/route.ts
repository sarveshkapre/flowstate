import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getConnectorBackpressurePolicy,
  getProject,
  upsertConnectorBackpressurePolicy,
} from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ projectId: string }>;
};

const updatePolicySchema = z
  .object({
    isEnabled: z.boolean().optional(),
    maxRetrying: z.coerce.number().int().positive().max(10_000).optional(),
    maxDueNow: z.coerce.number().int().positive().max(10_000).optional(),
    minLimit: z.coerce.number().int().positive().max(100).optional(),
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

  const policy = await getConnectorBackpressurePolicy(projectId);
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
    const policy = await upsertConnectorBackpressurePolicy({
      projectId,
      isEnabled: parsed.data.isEnabled,
      maxRetrying: parsed.data.maxRetrying,
      maxDueNow: parsed.data.maxDueNow,
      minLimit: parsed.data.minLimit,
      actor: auth.actor.email ?? "api-key",
    });

    return NextResponse.json({ policy });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update connector backpressure policy";
    const status = message === "Project not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
