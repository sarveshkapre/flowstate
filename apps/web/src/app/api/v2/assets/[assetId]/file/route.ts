import { promises as fs } from "node:fs";

import { NextResponse } from "next/server";

import { getDatasetAsset, resolveDatasetAssetBinarySource } from "@/lib/data-store-v2";
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

  const source = await resolveDatasetAssetBinarySource(asset);
  if (!source) {
    return NextResponse.json({ error: "Asset file not found" }, { status: 404 });
  }

  try {
    const bytes = await fs.readFile(source.filePath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": source.mimeType,
        "cache-control": "private, max-age=300",
        "content-disposition": `inline; filename="${source.fileName}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Asset file could not be read." }, { status: 404 });
  }
}
