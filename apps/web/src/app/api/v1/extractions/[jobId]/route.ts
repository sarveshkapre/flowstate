import { NextResponse } from "next/server";

import { assignReviewer, getExtractionJob, updateReviewStatus } from "@/lib/data-store";
import { requireV1Permission } from "@/lib/v1/auth";
import { parseExtractionPatchAction } from "@/lib/v1/extractions-request";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const unauthorized = await requireV1Permission(request, "read_project");
  if (unauthorized) {
    return unauthorized;
  }

  const { jobId } = await params;
  const job = await getExtractionJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}

export async function PATCH(request: Request, { params }: Params) {
  const unauthorized = await requireV1Permission(request, "review_queue");
  if (unauthorized) {
    return unauthorized;
  }

  const { jobId } = await params;
  const payload = await request.json().catch(() => null);
  const parsed = parseExtractionPatchAction(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated =
    parsed.data.action === "assign"
      ? await assignReviewer({
          jobId,
          reviewer: parsed.data.reviewer,
          actor: parsed.data.reviewer,
        })
      : await updateReviewStatus({
          jobId,
          reviewStatus: parsed.data.reviewStatus,
          reviewer: parsed.data.reviewer,
          reviewNotes: parsed.data.reviewNotes,
        });

  if (!updated) {
    return NextResponse.json(
      { error: "Job not found or action not allowed for current job state" },
      { status: 404 },
    );
  }

  return NextResponse.json({ job: updated });
}
