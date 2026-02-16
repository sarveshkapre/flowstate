import { NextResponse } from "next/server";
import { reviewStatusSchema } from "@flowstate/types";
import { z } from "zod";

import { getEvaluationRuns, runEvaluation } from "@/lib/eval-service";

const createEvalRunSchema = z.object({
  organizationId: z.string().min(1).max(120).optional(),
  reviewStatus: reviewStatusSchema.default("approved"),
  sampleLimit: z.number().int().positive().max(500).default(100),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId") || undefined;
  const reviewStatusParam = url.searchParams.get("reviewStatus");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  const parsedReviewStatus = reviewStatusParam ? reviewStatusSchema.safeParse(reviewStatusParam) : null;

  if (parsedReviewStatus && !parsedReviewStatus.success) {
    return NextResponse.json({ error: "Invalid reviewStatus" }, { status: 400 });
  }

  const runs = await getEvaluationRuns({
    organizationId,
    reviewStatus: parsedReviewStatus?.success ? parsedReviewStatus.data : undefined,
    limit: Number.isFinite(limit) && typeof limit === "number" ? Math.min(limit, 200) : undefined,
  });

  return NextResponse.json({ runs });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = createEvalRunSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await runEvaluation({
    organizationId: parsed.data.organizationId,
    reviewStatus: parsed.data.reviewStatus,
    sampleLimit: parsed.data.sampleLimit,
  });

  return NextResponse.json(result, { status: 201 });
}
