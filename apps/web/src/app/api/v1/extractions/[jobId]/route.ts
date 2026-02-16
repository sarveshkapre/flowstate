import { NextResponse } from "next/server";
import { z } from "zod";

import { getExtractionJob, updateReviewStatus } from "@/lib/data-store";

const patchSchema = z.object({
  reviewStatus: z.enum(["approved", "rejected"]),
  reviewer: z.string().max(120).optional(),
  reviewNotes: z.string().max(4000).optional(),
});

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_: Request, { params }: Params) {
  const { jobId } = await params;
  const job = await getExtractionJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}

export async function PATCH(request: Request, { params }: Params) {
  const { jobId } = await params;
  const payload = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await updateReviewStatus({
    jobId,
    reviewStatus: parsed.data.reviewStatus,
    reviewer: parsed.data.reviewer,
    reviewNotes: parsed.data.reviewNotes,
  });

  if (!updated) {
    return NextResponse.json(
      { error: "Job not found or not reviewable (must be completed first)" },
      { status: 404 },
    );
  }

  return NextResponse.json({ job: updated });
}
