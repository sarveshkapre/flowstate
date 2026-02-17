import { NextResponse } from "next/server";
import { z } from "zod";

import { createEdgeAgentConfig, getEdgeAgent, getLatestEdgeAgentConfig } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ agentId: string }>;
};

const updateConfigSchema = z.object({
  config: z.unknown(),
});

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

  const config = await getLatestEdgeAgentConfig(agentId);
  return NextResponse.json({ config });
}

export async function POST(request: Request, { params }: Params) {
  const { agentId } = await params;
  const agent = await getEdgeAgent(agentId);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "deploy_flow",
    projectId: agent.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = updateConfigSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const config = await createEdgeAgentConfig({
    agentId,
    config: parsed.data.config,
    actor: auth.actor.email ?? "api-key",
  });

  if (!config) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({ config }, { status: 201 });
}
