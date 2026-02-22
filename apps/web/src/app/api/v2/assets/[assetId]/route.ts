import { NextResponse } from "next/server";

import { deleteDatasetAsset, getDatasetAsset, getLatestAssetAnnotation } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ assetId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { assetId } = await params;
  const asset = await getDatasetAsset(assetId);

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: asset.project_id,
  });
  if (!auth.ok) {
    return auth.response;
  }

  const latestAnnotation = await getLatestAssetAnnotation(asset.id);
  return NextResponse.json({
    asset: {
      ...asset,
      latest_annotation: latestAnnotation,
    },
  });
}

export async function DELETE(request: Request, { params }: Params) {
  const { assetId } = await params;
  const asset = await getDatasetAsset(assetId);

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "manage_project",
    projectId: asset.project_id,
  });
  if (!auth.ok) {
    return auth.response;
  }

  await deleteDatasetAsset({
    assetId,
    actor: auth.actor.email ?? undefined,
  });

  return new NextResponse(null, { status: 204 });
}
