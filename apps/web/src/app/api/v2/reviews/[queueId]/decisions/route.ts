import { NextResponse } from "next/server";
import { failureReasonCodeSchema, reviewDecisionValueSchema } from "@flowstate/types";
import { z } from "zod";

import { createReviewDecision, getRunV2, listReviewDecisions } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";
import { isQueueProjectMatch } from "@/lib/v2/review-queue";

type Params = {
  params: Promise<{ queueId: string }>;
};

const createDecisionSchema = z.object({
  projectId: z.string().min(1),
  fieldName: z.string().min(1),
  decision: reviewDecisionValueSchema,
  failureReason: failureReasonCodeSchema.optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET(request: Request, { params }: Params) {
  const { queueId } = await params;
  const run = await getRunV2(queueId);

  if (!run) {
    return NextResponse.json({ error: "Queue not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "review_queue",
    projectId: run.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const decisions = await listReviewDecisions(queueId);
  return NextResponse.json({ decisions });
}

export async function POST(request: Request, { params }: Params) {
  const { queueId } = await params;
  const run = await getRunV2(queueId);

  if (!run) {
    return NextResponse.json({ error: "Queue not found" }, { status: 404 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = createDecisionSchema.safeParse(payload);

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

  const decision = await createReviewDecision({
    projectId: run.project_id,
    runId: queueId,
    fieldName: parsed.data.fieldName,
    decision: parsed.data.decision,
    failureReason: parsed.data.failureReason,
    reviewer: auth.actor.email ?? "api-key",
    notes: parsed.data.notes,
  });

  return NextResponse.json({ decision }, { status: 201 });
}
