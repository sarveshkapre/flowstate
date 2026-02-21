import { NextResponse } from "next/server";
import { z } from "zod";

import { attachEvidenceRegion, getReviewDecision, getRunV2, listEvidenceRegions } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { isDecisionOwnedByQueue, isQueueProjectMatch } from "@/lib/v2/review-queue";

type Params = {
  params: Promise<{ queueId: string }>;
};

const attachEvidenceSchema = z.object({
  projectId: z.string().min(1),
  reviewDecisionId: z.string().min(1),
  page: z.number().int().nonnegative(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

export async function GET(request: Request, { params }: Params) {
  const { queueId } = await params;
  const run = await getRunV2(queueId);

  if (!run) {
    return NextResponse.json({ error: "Queue not found" }, { status: 404 });
  }

  const reviewDecisionId = new URL(request.url).searchParams.get("reviewDecisionId");

  if (!reviewDecisionId) {
    return NextResponse.json({ error: "reviewDecisionId is required" }, { status: 400 });
  }

  const projectId = new URL(request.url).searchParams.get("projectId");

  const auth = await requirePermission({
    request,
    permission: "review_queue",
    projectId: run.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  if (!isQueueProjectMatch(projectId, run.project_id)) {
    return NextResponse.json({ error: "projectId does not match queue project" }, { status: 400 });
  }

  const decision = await getReviewDecision(reviewDecisionId);

  if (!isDecisionOwnedByQueue(decision, run)) {
    return NextResponse.json({ error: "Review decision not found in queue" }, { status: 404 });
  }

  const evidence = await listEvidenceRegions(reviewDecisionId);
  return NextResponse.json({ queueId, evidence });
}

export async function POST(request: Request, { params }: Params) {
  const { queueId } = await params;
  const run = await getRunV2(queueId);

  if (!run) {
    return NextResponse.json({ error: "Queue not found" }, { status: 404 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = attachEvidenceSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: "review_queue",
    projectId: run.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  if (!isQueueProjectMatch(parsed.data.projectId, run.project_id)) {
    return NextResponse.json({ error: "projectId does not match queue project" }, { status: 400 });
  }

  const decision = await getReviewDecision(parsed.data.reviewDecisionId);

  if (!isDecisionOwnedByQueue(decision, run)) {
    return NextResponse.json({ error: "Review decision not found in queue" }, { status: 404 });
  }

  const evidence = await attachEvidenceRegion({
    reviewDecisionId: parsed.data.reviewDecisionId,
    page: parsed.data.page,
    x: parsed.data.x,
    y: parsed.data.y,
    width: parsed.data.width,
    height: parsed.data.height,
  });

  return NextResponse.json({ queueId, evidence }, { status: 201 });
}
