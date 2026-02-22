import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getDatasetBatch,
  listDatasetAssetsByBatch,
  listLatestAssetAnnotations,
} from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { runAssetAutoLabel } from "@/lib/auto-label-service";

type Params = {
  params: Promise<{ batchId: string }>;
};

const autoLabelBatchSchema = z.object({
  prompt: z.string().max(3000).optional(),
  labelHints: z.array(z.string().min(1).max(200)).max(100).optional(),
  filter: z.enum(["all", "unlabeled"]).default("unlabeled"),
  maxAssets: z.number().int().min(1).max(500).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { batchId } = await params;
  const batch = await getDatasetBatch(batchId);
  if (!batch) {
    return NextResponse.json({ error: "Dataset batch not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "run_flow",
    projectId: batch.project_id,
  });
  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => ({}));
  const parsed = autoLabelBatchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const assets = await listDatasetAssetsByBatch({
    batchId,
    status: "ready",
    limit: parsed.data.maxAssets,
  });

  const assetIds = assets.map((asset) => asset.id);
  const latestAnnotationMap = await listLatestAssetAnnotations(assetIds);

  const runnableAssets = assets.filter((asset) => {
    if (asset.asset_type !== "image" && asset.asset_type !== "video_frame") {
      return false;
    }

    if (parsed.data.filter === "all") {
      return true;
    }

    return !latestAnnotationMap.has(asset.id);
  });

  const results = [];
  const errors: Array<{ assetId: string; error: string }> = [];

  for (const asset of runnableAssets) {
    try {
      const result = await runAssetAutoLabel(asset.id, {
        prompt: parsed.data.prompt,
        labelHints: parsed.data.labelHints,
        actor: auth.actor.email ?? undefined,
      });
      results.push({ assetId: asset.id, annotation: result.annotation });
    } catch (error) {
      errors.push({
        assetId: asset.id,
        error: error instanceof Error ? error.message : "Auto-label failed",
      });
    }
  }

  return NextResponse.json({
    batchId,
    processed: results.length,
    skipped: assets.length - runnableAssets.length,
    errors,
    results,
  });
}
