import { NextResponse } from "next/server";

import { listExtractionJobs } from "@/lib/data-store";
import { computeDriftInsights } from "@/lib/drift";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const daysParam = url.searchParams.get("days");
  const days = daysParam ? Number(daysParam) : 14;

  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    return NextResponse.json({ error: "Invalid days" }, { status: 400 });
  }

  const jobs = await listExtractionJobs({ status: "completed" });
  const drift = computeDriftInsights(jobs, days);

  return NextResponse.json({ drift });
}
