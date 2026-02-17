import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ type: string }>;
};

const deliverConnectorSchema = z.object({
  projectId: z.string().min(1),
  payload: z.unknown(),
  idempotencyKey: z.string().min(1).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { type } = await params;
  const body = await request.json().catch(() => null);
  const parsed = deliverConnectorSchema.safeParse(body);

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

  return NextResponse.json(
    {
      connector_type: type,
      project_id: parsed.data.projectId,
      idempotency_key: parsed.data.idempotencyKey ?? null,
      accepted: true,
      mode: "simulated",
    },
    { status: 202 },
  );
}
