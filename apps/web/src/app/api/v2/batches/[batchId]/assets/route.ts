import { NextResponse } from "next/server";
import { z } from "zod";

import { createDatasetAssets, getDatasetBatch, listDatasetAssetsByBatch } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ batchId: string }>;
};

const createDatasetAssetsSchema = z.object({
  assets: z
    .array(
      z.object({
        artifactId: z.string().min(1).optional(),
        assetType: z.enum(["image", "video_frame", "pdf_page"]),
        storagePath: z.string().min(1).max(5000),
        status: z.enum(["pending", "ready", "failed", "archived"]).optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        frameIndex: z.number().int().nonnegative().optional(),
        timestampMs: z.number().int().nonnegative().optional(),
        pageNumber: z.number().int().positive().optional(),
        sha256: z.string().min(1).optional(),
      }),
    )
    .min(1)
    .max(1000),
});

export async function GET(request: Request, { params }: Params) {
  const { batchId } = await params;
  const batch = await getDatasetBatch(batchId);

  if (!batch) {
    return NextResponse.json({ error: "Dataset batch not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: batch.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const limitParam = url.searchParams.get("limit");
  const limit =
    limitParam && Number.isFinite(Number(limitParam)) && Number(limitParam) > 0 ? Math.floor(Number(limitParam)) : undefined;
  const statusSchema = z.enum(["pending", "ready", "failed", "archived"]);
  const parsedStatus = statusParam ? statusSchema.safeParse(statusParam) : null;

  if (parsedStatus && !parsedStatus.success) {
    return NextResponse.json(
      {
        error: "Invalid status query parameter",
        details: parsedStatus.error.flatten(),
      },
      { status: 400 },
    );
  }

  const assets = await listDatasetAssetsByBatch({
    batchId,
    status: parsedStatus?.success ? parsedStatus.data : undefined,
    limit,
  });

  return NextResponse.json({ assets });
}

export async function POST(request: Request, { params }: Params) {
  const { batchId } = await params;
  const batch = await getDatasetBatch(batchId);

  if (!batch) {
    return NextResponse.json({ error: "Dataset batch not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "create_flow",
    projectId: batch.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = createDatasetAssetsSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const assets = await createDatasetAssets({
    batchId,
    assets: parsed.data.assets,
    actor: auth.actor.email ?? undefined,
  });

  return NextResponse.json({ assets }, { status: 201 });
}
