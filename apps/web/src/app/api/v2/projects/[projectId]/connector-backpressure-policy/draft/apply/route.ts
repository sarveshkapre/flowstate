import { NextResponse } from "next/server";

import { applyConnectorBackpressurePolicyDraft, getProject } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ projectId: string }>;
};

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

  try {
    const policy = await applyConnectorBackpressurePolicyDraft({
      projectId,
      actor: auth.actor.email ?? "api-key",
    });

    return NextResponse.json({ policy, draft_cleared: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to apply connector backpressure draft";
    const status = message === "Backpressure policy draft not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
