import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getDatasetBatch,
  setDatasetBatchStatus,
} from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ batchId: string }>;
};

const updateBatchSchema = z.object({
  status: z.enum([
    "uploaded",
    "preprocessing",
    "ready_for_label",
    "in_labeling",
    "in_review",
    "approved",
    "rework",
    "exported",
  ]),
});

export async function GET(request: Request, { params }: Params) {
  const { batchId } = await params;
  const batch = await getDatasetBatch(batchId);

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: batch.project_id,
  });
  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json({ batch });
}

export async function PATCH(request: Request, { params }: Params) {
  const { batchId } = await params;
  const batch = await getDatasetBatch(batchId);

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "review_queue",
    projectId: batch.project_id,
  });
  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = updateBatchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await setDatasetBatchStatus({
    batchId,
    status: parsed.data.status,
    actor: auth.actor.email ?? undefined,
  });

  return NextResponse.json({ batch: updated });
}
