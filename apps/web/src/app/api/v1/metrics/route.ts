import { NextResponse } from "next/server";

import { listExtractionJobs } from "@/lib/data-store";
import { summarizeJobs } from "@/lib/metrics";

export async function GET() {
  const jobs = await listExtractionJobs();
  const summary = summarizeJobs(jobs);

  return NextResponse.json({ summary });
}
