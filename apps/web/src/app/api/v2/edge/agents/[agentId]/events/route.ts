import { NextResponse } from "next/server";
import { z } from "zod";

import { appendEdgeAgentEvent } from "@/lib/data-store-v2";

const eventSchema = z.object({
  eventType: z.string().min(1).max(120),
  payload: z.unknown(),
});

type Params = {
  params: Promise<{ agentId: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { agentId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = eventSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const event = await appendEdgeAgentEvent({
    agentId,
    eventType: parsed.data.eventType,
    payload: parsed.data.payload,
  });

  if (!event) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({ event }, { status: 201 });
}
