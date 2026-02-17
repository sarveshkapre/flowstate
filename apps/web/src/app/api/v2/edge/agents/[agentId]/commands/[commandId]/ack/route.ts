import { NextResponse } from "next/server";
import { z } from "zod";

import { acknowledgeEdgeAgentCommand, getEdgeAgent } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ agentId: string; commandId: string }>;
};

const ackSchema = z.object({
  status: z.enum(["acknowledged", "failed"]),
  result: z.unknown().optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { agentId, commandId } = await params;
  const agent = await getEdgeAgent(agentId);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "run_flow",
    projectId: agent.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = ackSchema.safeParse(payload ?? {});

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const command = await acknowledgeEdgeAgentCommand({
    agentId,
    commandId,
    status: parsed.data.status,
    result: parsed.data.result,
    actor: auth.actor.email ?? "api-key",
  });

  if (!command) {
    return NextResponse.json({ error: "Command not found" }, { status: 404 });
  }

  return NextResponse.json({ command });
}
