import { NextResponse } from "next/server";
import { z } from "zod";

import { createDatasetBatch, getDataset, listDatasetBatches } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ datasetId: string }>;
};

const createDatasetBatchSchema = z.object({
  name: z.string().min(1).max(160),
  tags: z.array(z.string().min(1).max(40)).max(40).optional(),
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

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const limitParam = url.searchParams.get("limit");
  const statusSchema = z.enum([
    "uploaded",
    "preprocessing",
    "ready_for_label",
    "in_labeling",
    "in_review",
    "approved",
    "rework",
    "exported",
  ]);
  const parsedStatus = statusParam ? statusSchema.safeParse(statusParam) : null;
  const parsedLimit = limitParam ? Number(limitParam) : undefined;

  if (parsedStatus && !parsedStatus.success) {
    return NextResponse.json({ error: "Invalid status query parameter", details: parsedStatus.error.flatten() }, { status: 400 });
  }

  if (limitParam && (!Number.isFinite(parsedLimit) || Number(parsedLimit) <= 0)) {
    return NextResponse.json({ error: "Invalid limit query parameter" }, { status: 400 });
  }

  const batches = await listDatasetBatches({
    datasetId,
    status: parsedStatus?.success ? parsedStatus.data : undefined,
    limit: parsedLimit,
  });
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
    tags: parsed.data.tags,
    sourceType: parsed.data.sourceType,
    sourceArtifactIds: parsed.data.sourceArtifactIds,
    actor: auth.actor.email ?? undefined,
  });

  return NextResponse.json({ batch }, { status: 201 });
}
