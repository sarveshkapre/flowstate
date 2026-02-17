import { NextResponse } from "next/server";
import { z } from "zod";

import { createFlowDeployment, getFlowV2, getFlowVersion, listFlowDeployments } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ flowId: string }>;
};

const deploySchema = z.object({
  flowVersionId: z.string().min(1),
});

export async function GET(request: Request, { params }: Params) {
  const { flowId } = await params;
  const flow = await getFlowV2(flowId);

  if (!flow) {
    return NextResponse.json({ error: "Flow not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: flow.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const deployments = await listFlowDeployments(flowId);
  return NextResponse.json({ deployments });
}

export async function POST(request: Request, { params }: Params) {
  const { flowId } = await params;
  const flow = await getFlowV2(flowId);

  if (!flow) {
    return NextResponse.json({ error: "Flow not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "deploy_flow",
    projectId: flow.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = deploySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const version = await getFlowVersion(parsed.data.flowVersionId);

  if (!version || version.flow_id !== flowId) {
    return NextResponse.json({ error: "Flow version not found" }, { status: 404 });
  }

  const deployment = await createFlowDeployment({
    flowId,
    flowVersionId: parsed.data.flowVersionId,
    actor: auth.actor.email ?? undefined,
  });

  return NextResponse.json({ deployment }, { status: 201 });
}
