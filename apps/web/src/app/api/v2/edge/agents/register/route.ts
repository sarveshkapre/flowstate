import { NextResponse } from "next/server";
import { z } from "zod";

import { registerEdgeAgent } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

const registerEdgeAgentSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  platform: z.string().min(1).max(120),
});

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = registerEdgeAgentSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: "run_flow",
    projectId: parsed.data.projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const agent = await registerEdgeAgent({
    projectId: parsed.data.projectId,
    name: parsed.data.name,
    platform: parsed.data.platform,
  });

  return NextResponse.json({ agent }, { status: 201 });
}
