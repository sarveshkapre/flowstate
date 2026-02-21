import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getConnectorBackpressurePolicyDraft,
  getProject,
  upsertConnectorBackpressurePolicyDraft,
} from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ projectId: string }>;
};

const updateDraftSchema = z
  .object({
    isEnabled: z.boolean().optional(),
    maxRetrying: z.coerce.number().int().positive().max(10_000).optional(),
    maxDueNow: z.coerce.number().int().positive().max(10_000).optional(),
    minLimit: z.coerce.number().int().positive().max(100).optional(),
    connectorOverrides: z
      .record(
        z.string(),
        z.object({
          isEnabled: z.boolean(),
          maxRetrying: z.coerce.number().int().positive().max(10_000),
          maxDueNow: z.coerce.number().int().positive().max(10_000),
          minLimit: z.coerce.number().int().positive().max(100),
        }),
      )
      .optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one draft field is required",
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

  const draft = await getConnectorBackpressurePolicyDraft(projectId);
  return NextResponse.json({ draft });
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
  const parsed = updateDraftSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const draft = await upsertConnectorBackpressurePolicyDraft({
      projectId,
      isEnabled: parsed.data.isEnabled,
      maxRetrying: parsed.data.maxRetrying,
      maxDueNow: parsed.data.maxDueNow,
      minLimit: parsed.data.minLimit,
      connectorOverrides: parsed.data.connectorOverrides,
      actor: auth.actor.email ?? "api-key",
    });

    return NextResponse.json({ draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save connector backpressure draft";
    const status = message === "Project not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
