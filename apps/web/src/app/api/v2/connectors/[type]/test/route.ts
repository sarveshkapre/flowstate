import { NextResponse } from "next/server";
import { z } from "zod";

import { assertJsonBodySize, connectorTypeSchema, invalidRequestResponse, sanitizeForStorage } from "@/lib/v2/request-security";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ type: string }>;
};

const testConnectorSchema = z.object({
  projectId: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const parsedType = connectorTypeSchema.safeParse((await params).type);

  if (!parsedType.success) {
    return NextResponse.json({ error: "Invalid connector type" }, { status: 400 });
  }
  const type = parsedType.data;
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

  try {
    assertJsonBodySize(parsed.data.config ?? {});
  } catch (error) {
    return invalidRequestResponse(error);
  }

  return NextResponse.json({
    connector_type: type,
    project_id: parsed.data.projectId,
    status: "ok",
    sanitized_config_preview: sanitizeForStorage(parsed.data.config ?? {}),
    message: "Connector config accepted for test in this milestone slice.",
  });
}
