import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createDatasetVersionFromLatestAnnotations,
  getDataset,
} from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ datasetId: string }>;
};

const buildSchema = z.object({
  batchId: z.string().min(1).optional(),
});

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

  const payload = await request.json().catch(() => ({}));
  const parsed = buildSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const version = await createDatasetVersionFromLatestAnnotations({
    datasetId,
    batchId: parsed.data.batchId,
    actor: auth.actor.email ?? undefined,
  });

  return NextResponse.json({ version }, { status: 201 });
}
