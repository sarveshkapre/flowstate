import { NextResponse } from "next/server";
import { flowGraphSchema } from "@flowstate/types";
import { z } from "zod";

import { createFlowVersion, getFlowV2, listFlowVersions } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ flowId: string }>;
};

const createFlowVersionSchema = z.object({
  graph: flowGraphSchema,
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

  const versions = await listFlowVersions(flowId);
  return NextResponse.json({ versions });
}

export async function POST(request: Request, { params }: Params) {
  const { flowId } = await params;
  const flow = await getFlowV2(flowId);

  if (!flow) {
    return NextResponse.json({ error: "Flow not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "create_flow",
    projectId: flow.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = createFlowVersionSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const version = await createFlowVersion({
    flowId,
    graph: parsed.data.graph,
    actor: auth.actor.email ?? undefined,
  });

  return NextResponse.json({ version }, { status: 201 });
}
