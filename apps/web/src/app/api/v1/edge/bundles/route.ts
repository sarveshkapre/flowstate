import { NextResponse } from "next/server";
import { edgeAdapterSchema } from "@flowstate/types";
import { z } from "zod";

import { createEdgeDeploymentBundle, listBundles } from "@/lib/edge-bundle-service";

const createBundleSchema = z.object({
  workflowId: z.string().uuid(),
  adapterId: edgeAdapterSchema,
  model: z.string().min(1).max(120).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workflowId = url.searchParams.get("workflowId") || undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  const bundles = await listBundles({
    workflowId,
    limit: Number.isFinite(limit) && typeof limit === "number" ? Math.min(limit, 200) : undefined,
  });

  return NextResponse.json({ bundles });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = createBundleSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await createEdgeDeploymentBundle({
    workflowId: parsed.data.workflowId,
    adapterId: parsed.data.adapterId,
    model: parsed.data.model,
  });

  if (!result) {
    return NextResponse.json({ error: "Workflow or adapter not found" }, { status: 404 });
  }

  return NextResponse.json(result, { status: 201 });
}
