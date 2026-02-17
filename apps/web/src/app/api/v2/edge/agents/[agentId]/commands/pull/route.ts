import { NextResponse } from "next/server";
import { z } from "zod";

import { claimEdgeAgentCommands, getEdgeAgent } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ agentId: string }>;
};

const pullSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { agentId } = await params;
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
  const parsed = pullSchema.safeParse(payload ?? {});

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const commands = await claimEdgeAgentCommands({
    agentId,
    limit: parsed.data.limit,
  });

  if (!commands) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({ commands });
}
