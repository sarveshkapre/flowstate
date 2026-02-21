import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { reviewStatusSchema } from "@flowstate/types";
import { z } from "zod";

import {
  createDatasetSnapshotRecord,
  listDatasetSnapshots,
  listExtractionJobs,
  writeSnapshotJsonl,
} from "@/lib/data-store";
import { requireV1Permission } from "@/lib/v1/auth";

const createSchema = z.object({
  reviewStatus: reviewStatusSchema.default("approved"),
});

function buildSnapshotFileName() {
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  return `snapshot-${stamp}-${randomUUID().slice(0, 8)}.jsonl`;
}

export async function GET(request: Request) {
  const unauthorized = await requireV1Permission(request, "read_project");
  if (unauthorized) {
    return unauthorized;
  }

  const snapshots = await listDatasetSnapshots();
  return NextResponse.json({ snapshots });
}

export async function POST(request: Request) {
  const unauthorized = await requireV1Permission(request, "create_flow");
  if (unauthorized) {
    return unauthorized;
  }

  const payload = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const jobs = await listExtractionJobs({
    status: "completed",
    reviewStatus: parsed.data.reviewStatus,
  });

  const lines = jobs.map((job) =>
    JSON.stringify({
      job_id: job.id,
      artifact_id: job.artifact_id,
      document_type: job.document_type,
      review_status: job.review_status,
      result: job.result,
      validation: job.validation,
      created_at: job.created_at,
      updated_at: job.updated_at,
    }),
  );

  const fileName = buildSnapshotFileName();
  await writeSnapshotJsonl({ fileName, lines });

  const snapshot = await createDatasetSnapshotRecord({
    reviewStatus: parsed.data.reviewStatus,
    itemCount: jobs.length,
    fileName,
  });

  return NextResponse.json({ snapshot }, { status: 201 });
}
