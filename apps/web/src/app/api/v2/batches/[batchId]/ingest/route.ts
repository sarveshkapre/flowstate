import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatasetBatch, ingestDatasetBatch } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ batchId: string }>;
};

const ingestBatchSchema = z.object({
  force: z.boolean().optional(),
  maxVideoFrames: z.number().int().positive().max(120).optional(),
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

  const payload = await request.json().catch(() => null);
  const parsed = ingestBatchSchema.safeParse(payload ?? {});

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await ingestDatasetBatch({
    batchId,
    force: parsed.data.force,
    maxVideoFrames: parsed.data.maxVideoFrames,
    actor: auth.actor.email ?? undefined,
  });

  if (result.already_ingested) {
    return NextResponse.json(
      {
        error: "Batch already ingested. Set force=true to reingest.",
        result,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ result });
}
