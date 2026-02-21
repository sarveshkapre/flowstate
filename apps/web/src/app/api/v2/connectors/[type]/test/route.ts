import { NextResponse } from "next/server";
import { z } from "zod";

import { assertJsonBodySize, connectorTypeSchema, invalidRequestResponse, sanitizeForStorage } from "@/lib/v2/request-security";
import { requirePermission } from "@/lib/v2/auth";
import { dispatchConnectorDelivery, normalizeConnectorType, validateConnectorConfig } from "@/lib/v2/connector-runtime";

type Params = {
  params: Promise<{ type: string }>;
};

const testConnectorSchema = z.object({
  projectId: z.string().min(1),
  mode: z.enum(["validate", "dispatch"]).default("validate"),
  config: z.record(z.string(), z.unknown()).optional(),
  payload: z.unknown().optional(),
});

export async function POST(request: Request, { params }: Params) {
  const parsedType = connectorTypeSchema.safeParse((await params).type);

  if (!parsedType.success) {
    return NextResponse.json({ error: "Invalid connector type" }, { status: 400 });
  }
  const type = parsedType.data;
  const normalizedType = normalizeConnectorType(type);
  const payload = await request.json().catch(() => null);
  const parsed = testConnectorSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: parsed.data.mode === "dispatch" ? "run_flow" : "deploy_flow",
    projectId: parsed.data.projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  try {
    assertJsonBodySize(parsed.data.config ?? {});
    if (parsed.data.mode === "dispatch") {
      assertJsonBodySize(parsed.data.payload ?? {});
    }
  } catch (error) {
    return invalidRequestResponse(error);
  }

  const validation = validateConnectorConfig(type, parsed.data.config ?? {});

  if (!validation.ok) {
    return NextResponse.json(
      {
        connector_type: type,
        connector_normalized_type: normalizedType,
        project_id: parsed.data.projectId,
        status: "invalid",
        errors: validation.errors,
        sanitized_config_preview: sanitizeForStorage(parsed.data.config ?? {}),
      },
      { status: 400 },
    );
  }

  if (parsed.data.mode === "dispatch") {
    const delivery = await dispatchConnectorDelivery({
      connectorTypeRaw: type,
      config: parsed.data.config ?? {},
      payload:
        parsed.data.payload ??
        {
          event: "connector.test.dispatch",
          generated_at: new Date().toISOString(),
          project_id: parsed.data.projectId,
          connector_type: type,
        },
    });

    if (!delivery.success) {
      return NextResponse.json(
        {
          connector_type: type,
          connector_normalized_type: normalizedType,
          project_id: parsed.data.projectId,
          status: "failed",
          mode: "dispatch",
          sanitized_config_preview: sanitizeForStorage(parsed.data.config ?? {}),
          payload_preview: sanitizeForStorage(parsed.data.payload ?? null),
          delivery,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      connector_type: type,
      connector_normalized_type: normalizedType,
      project_id: parsed.data.projectId,
      status: "ok",
      mode: "dispatch",
      sanitized_config_preview: sanitizeForStorage(parsed.data.config ?? {}),
      payload_preview: sanitizeForStorage(parsed.data.payload ?? null),
      delivery,
      message: "Connector test dispatch delivered successfully.",
    });
  }

  return NextResponse.json({
    connector_type: type,
    connector_normalized_type: normalizedType,
    project_id: parsed.data.projectId,
    status: "ok",
    mode: "validated",
    sanitized_config_preview: sanitizeForStorage(parsed.data.config ?? {}),
    message: "Connector config validated and ready for delivery attempts.",
  });
}
