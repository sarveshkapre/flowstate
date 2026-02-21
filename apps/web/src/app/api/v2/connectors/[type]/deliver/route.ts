import { NextResponse } from "next/server";
import { z } from "zod";

import { listConnectorDeliveries, listConnectorDeliveryAttempts, processConnectorDelivery } from "@/lib/data-store-v2";
import {
  assertJsonBodySize,
  connectorTypeSchema,
  invalidRequestResponse,
} from "@/lib/v2/request-security";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ type: string }>;
};

const deliverConnectorSchema = z.object({
  projectId: z.string().min(1),
  payload: z.unknown(),
  config: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(1).optional(),
  maxAttempts: z.number().int().positive().max(10).optional(),
  initialBackoffMs: z.number().int().positive().max(60_000).optional(),
});

export async function GET(request: Request, { params }: Params) {
  const parsedType = connectorTypeSchema.safeParse((await params).type);

  if (!parsedType.success) {
    return NextResponse.json({ error: "Invalid connector type" }, { status: 400 });
  }
  const type = parsedType.data;
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const statusParam = url.searchParams.get("status");
  const limitParam = Number(url.searchParams.get("limit") || "");
  const status = statusParam && ["queued", "retrying", "delivered", "dead_lettered"].includes(statusParam) ? statusParam : undefined;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : undefined;

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const deliveries = await listConnectorDeliveries({
    projectId,
    connectorType: type,
    status: status as "queued" | "retrying" | "delivered" | "dead_lettered" | undefined,
    limit,
  });

  const items = await Promise.all(
    deliveries.map(async (delivery) => ({
      ...delivery,
      attempts: await listConnectorDeliveryAttempts(delivery.id),
    })),
  );

  return NextResponse.json({
    connector_type: type,
    project_id: projectId,
    deliveries: items,
  });
}

export async function POST(request: Request, { params }: Params) {
  const parsedType = connectorTypeSchema.safeParse((await params).type);

  if (!parsedType.success) {
    return NextResponse.json({ error: "Invalid connector type" }, { status: 400 });
  }
  const type = parsedType.data;
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

  try {
    assertJsonBodySize(parsed.data.payload);
    assertJsonBodySize(parsed.data.config ?? {});
  } catch (error) {
    return invalidRequestResponse(error);
  }

  const result = await processConnectorDelivery({
    projectId: parsed.data.projectId,
    connectorType: type,
    payload: parsed.data.payload,
    config: parsed.data.config,
    idempotencyKey: parsed.data.idempotencyKey,
    maxAttempts: parsed.data.maxAttempts,
    initialBackoffMs: parsed.data.initialBackoffMs,
    actor: auth.actor.email ?? "api-key",
  });

  return NextResponse.json(
    {
      connector_type: type,
      project_id: parsed.data.projectId,
      delivery: result.delivery,
      attempts: result.attempts,
      duplicate: result.duplicate,
    },
    { status: result.duplicate ? 200 : 202 },
  );
}
