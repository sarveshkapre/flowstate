import { NextResponse } from "next/server";
import { z } from "zod";

import { createDatasetBatch, getDataset, listDatasetBatches } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ datasetId: string }>;
};

const createDatasetBatchSchema = z.object({
  name: z.string().min(1).max(160),
  sourceType: z.enum(["image", "video", "pdf", "mixed"]),
  sourceArtifactIds: z.array(z.string().min(1)).max(500).optional(),
});

export async function GET(request: Request, { params }: Params) {
  const { datasetId } = await params;
  const dataset = await getDataset(datasetId);

  if (!dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: dataset.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const batches = await listDatasetBatches(datasetId);
  return NextResponse.json({ batches });
}

export async function POST(request: Request, { params }: Params) {
  const { datasetId } = await params;
  const dataset = await getDataset(datasetId);

  if (!dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "create_flow",
    projectId: dataset.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = createDatasetBatchSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const batch = await createDatasetBatch({
    datasetId,
    name: parsed.data.name,
    sourceType: parsed.data.sourceType,
    sourceArtifactIds: parsed.data.sourceArtifactIds,
    actor: auth.actor.email ?? undefined,
  });

  return NextResponse.json({ batch }, { status: 201 });
}
