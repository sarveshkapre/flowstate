import { NextResponse } from "next/server";

import { getEdgeAgent, getEdgeAgentHealth } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ agentId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { agentId } = await params;
  const agent = await getEdgeAgent(agentId);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: agent.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const health = await getEdgeAgentHealth(agentId);

  if (!health) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({ health });
}
