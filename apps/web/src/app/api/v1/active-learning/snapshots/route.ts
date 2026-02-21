import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createDatasetSnapshotRecord,
  listExtractionJobs,
  writeSnapshotJsonl,
} from "@/lib/data-store";
import { selectActiveLearningCandidates } from "@/lib/active-learning";
import { requireV1Permission } from "@/lib/v1/auth";

const createSchema = z.object({
  max: z.number().int().positive().max(5000).default(200),
  threshold: z.number().min(0).max(1).default(0.78),
  jobIds: z.array(z.string().uuid()).optional(),
});

function buildSnapshotFileName() {
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  return `active-learning-${stamp}-${randomUUID().slice(0, 8)}.jsonl`;
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

  const jobs = await listExtractionJobs({ status: "completed" });
  let candidates = selectActiveLearningCandidates(jobs, {
    max: parsed.data.max,
    confidenceThreshold: parsed.data.threshold,
  });

  if (parsed.data.jobIds?.length) {
    const idSet = new Set(parsed.data.jobIds);
    candidates = candidates.filter((job) => idSet.has(job.id));
  }

  const lines = candidates.map((job) =>
    JSON.stringify({
      job_id: job.id,
      artifact_id: job.artifact_id,
      document_type: job.document_type,
      review_status: job.review_status,
      result: job.result,
      validation: job.validation,
      updated_at: job.updated_at,
    }),
  );

  const fileName = buildSnapshotFileName();
  await writeSnapshotJsonl({ fileName, lines });

  const snapshot = await createDatasetSnapshotRecord({
    reviewStatus: "pending",
    itemCount: candidates.length,
    fileName,
  });

  return NextResponse.json({ snapshot, count: candidates.length }, { status: 201 });
}
