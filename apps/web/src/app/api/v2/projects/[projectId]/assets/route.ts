import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listDatasetAssetsByProject,
  listLatestAssetAnnotations,
} from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ projectId: string }>;
};

const statusSchema = z.enum(["pending", "ready", "failed", "archived"]);

export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const datasetId = url.searchParams.get("datasetId") || undefined;
  const batchId = url.searchParams.get("batchId") || undefined;
  const statusParam = url.searchParams.get("status");
  const limitParam = url.searchParams.get("limit");
  const includeLatestAnnotation = url.searchParams.get("includeLatestAnnotation") === "true";
  const parsedStatus = statusParam ? statusSchema.safeParse(statusParam) : null;

  if (parsedStatus && !parsedStatus.success) {
    return NextResponse.json(
      { error: "Invalid status query parameter", details: parsedStatus.error.flatten() },
      { status: 400 },
    );
  }

  const limit = limitParam ? Number(limitParam) : undefined;
  if (limitParam && (!Number.isFinite(limit) || Number(limit) <= 0)) {
    return NextResponse.json({ error: "Invalid limit query parameter" }, { status: 400 });
  }

  const assets = await listDatasetAssetsByProject({
    projectId,
    datasetId,
    batchId,
    status: parsedStatus?.success ? parsedStatus.data : undefined,
    limit,
  });

  if (!includeLatestAnnotation) {
    return NextResponse.json({ assets });
  }

  const latestAnnotations = await listLatestAssetAnnotations(assets.map((asset) => asset.id));
  return NextResponse.json({
    assets: assets.map((asset) => ({
      ...asset,
      latest_annotation: latestAnnotations.get(asset.id) ?? null,
    })),
  });
}
