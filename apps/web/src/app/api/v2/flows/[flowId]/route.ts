import { NextResponse } from "next/server";

import { deleteFlowV2, getFlowV2 } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ flowId: string }>;
};

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

  return NextResponse.json({ flow });
}

export async function DELETE(request: Request, { params }: Params) {
  const { flowId } = await params;
  const flow = await getFlowV2(flowId);

  if (!flow) {
    return NextResponse.json({ error: "Flow not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "manage_project",
    projectId: flow.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  await deleteFlowV2({
    flowId,
    actor: auth.actor.email ?? undefined,
  });

  return new NextResponse(null, { status: 204 });
}
