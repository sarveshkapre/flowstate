import { NextResponse } from "next/server";
import { edgeAgentCommandStatusSchema } from "@flowstate/types";
import { z } from "zod";

import { enqueueEdgeAgentCommand, getEdgeAgent, listEdgeAgentCommands } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ agentId: string }>;
};

const enqueueCommandSchema = z.object({
  commandType: z.string().min(1).max(120),
  payload: z.unknown(),
  expiresAt: z.iso.datetime().optional(),
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

  const url = new URL(request.url);
  const statusValue = url.searchParams.get("status");
  const statusParsed = statusValue ? edgeAgentCommandStatusSchema.safeParse(statusValue) : null;
  const status = statusParsed?.success ? statusParsed.data : undefined;
  const limitParam = Number(url.searchParams.get("limit") || "");
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : undefined;

  const commands = await listEdgeAgentCommands({
    agentId,
    status,
    limit,
  });

  return NextResponse.json({ commands });
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

  const body = await request.json().catch(() => null);
  const parsed = enqueueCommandSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const command = await enqueueEdgeAgentCommand({
    agentId,
    commandType: parsed.data.commandType,
    payload: parsed.data.payload,
    expiresAt: parsed.data.expiresAt,
    actor: auth.actor.email ?? "api-key",
  });

  if (!command) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({ command }, { status: 201 });
}
