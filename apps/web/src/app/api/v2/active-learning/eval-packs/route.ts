import { NextResponse } from "next/server";
import { z } from "zod";

import { createEvalPack, listEvalPacks } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

const createEvalPackSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(160),
  candidateRunIds: z.array(z.string().min(1)).min(1),
});

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const auth = await requirePermission({ request, permission: "read_project", projectId });

  if (!auth.ok) {
    return auth.response;
  }

  const packs = await listEvalPacks(projectId);
  return NextResponse.json({ packs });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = createEvalPackSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: "create_flow",
    projectId: parsed.data.projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const pack = await createEvalPack({
    projectId: parsed.data.projectId,
    name: parsed.data.name,
    candidateRunIds: parsed.data.candidateRunIds,
    actor: auth.actor.email ?? undefined,
  });

  return NextResponse.json({ pack }, { status: 201 });
}
