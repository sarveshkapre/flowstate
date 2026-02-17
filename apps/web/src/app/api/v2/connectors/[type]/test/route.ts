import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ type: string }>;
};

const testConnectorSchema = z.object({
  projectId: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { type } = await params;
  const payload = await request.json().catch(() => null);
  const parsed = testConnectorSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: "deploy_flow",
    projectId: parsed.data.projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json({
    connector_type: type,
    project_id: parsed.data.projectId,
    status: "ok",
    message: "Connector config accepted for test in this milestone slice.",
  });
}
