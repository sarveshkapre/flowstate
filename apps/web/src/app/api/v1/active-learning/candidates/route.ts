import { NextResponse } from "next/server";

import { listExtractionJobs } from "@/lib/data-store";
import { selectActiveLearningCandidates } from "@/lib/active-learning";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const maxParam = url.searchParams.get("max");
  const thresholdParam = url.searchParams.get("threshold");

  const max = maxParam ? Number(maxParam) : undefined;
  const threshold = thresholdParam ? Number(thresholdParam) : undefined;

  if (max !== undefined && (!Number.isFinite(max) || max <= 0)) {
    return NextResponse.json({ error: "Invalid max" }, { status: 400 });
  }

  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
    return NextResponse.json({ error: "Invalid threshold" }, { status: 400 });
  }

  const jobs = await listExtractionJobs({ status: "completed" });
  const candidates = selectActiveLearningCandidates(jobs, {
    max,
    confidenceThreshold: threshold,
  });

  return NextResponse.json({ candidates, count: candidates.length });
}
