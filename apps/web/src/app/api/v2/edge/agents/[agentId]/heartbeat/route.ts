import { NextResponse } from "next/server";
import { z } from "zod";

import { touchEdgeAgentHeartbeat } from "@/lib/data-store-v2";

const heartbeatSchema = z.object({
  checkpoint: z
    .object({
      key: z.string().min(1),
      value: z.string().min(1),
    })
    .optional(),
});

type Params = {
  params: Promise<{ agentId: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { agentId } = await params;
  const payload = await request.json().catch(() => null);
  const parsed = heartbeatSchema.safeParse(payload ?? {});

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const agent = await touchEdgeAgentHeartbeat({
    agentId,
    checkpoint: parsed.data.checkpoint,
  });

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({ agent });
}
