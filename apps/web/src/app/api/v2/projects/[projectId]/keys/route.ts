import { NextResponse } from "next/server";
import { apiKeyScopeSchema, projectMemberRoleSchema } from "@flowstate/types";
import { z } from "zod";

import { createApiKey, getProject, listApiKeys } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ projectId: string }>;
};

const createKeySchema = z.object({
  name: z.string().min(1).max(120),
  role: projectMemberRoleSchema.default("builder"),
  scopes: z.array(apiKeyScopeSchema).min(1),
  expiresAt: z.iso.datetime().optional(),
});

export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({
    request,
    permission: "manage_keys",
    projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const keys = await listApiKeys({ projectId });
  return NextResponse.json({ keys });
}

export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({
    request,
    permission: "manage_keys",
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
  const parsed = createKeySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await createApiKey({
    organizationId: project.organization_id,
    projectId,
    name: parsed.data.name,
    role: parsed.data.role,
    scopes: parsed.data.scopes,
    expiresAt: parsed.data.expiresAt,
    actor: auth.actor.email ?? undefined,
  });

  return NextResponse.json(
    {
      apiKey: result.record,
      token: result.token,
      hint: "Token is only returned once. Store it securely.",
    },
    { status: 201 },
  );
}
