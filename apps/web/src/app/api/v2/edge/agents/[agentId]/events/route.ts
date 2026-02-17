import { NextResponse } from "next/server";
import { z } from "zod";

import { appendEdgeAgentEvent, getEdgeAgent, listEdgeAgentEvents } from "@/lib/data-store-v2";
import { assertJsonBodySize, invalidRequestResponse, sanitizeForStorage } from "@/lib/v2/request-security";
import { requirePermission } from "@/lib/v2/auth";

const eventSchema = z.object({
  eventType: z.string().min(1).max(120),
  payload: z.unknown(),
});

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

  const url = new URL(request.url);
  const eventType = url.searchParams.get("eventType") || undefined;
  const limitParam = Number(url.searchParams.get("limit") || "");
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : undefined;

  const events = await listEdgeAgentEvents({
    agentId,
    eventType,
    limit,
  });

  return NextResponse.json({ events });
}

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

  const body = await request.json().catch(() => null);
  const parsed = eventSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    assertJsonBodySize(parsed.data.payload);
  } catch (error) {
    return invalidRequestResponse(error);
  }

  const event = await appendEdgeAgentEvent({
    agentId,
    eventType: parsed.data.eventType,
    payload: sanitizeForStorage(parsed.data.payload),
  });

  if (!event) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({ event }, { status: 201 });
}
