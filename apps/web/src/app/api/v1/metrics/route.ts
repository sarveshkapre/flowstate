import { NextResponse } from "next/server";

import { listExtractionJobs } from "@/lib/data-store";
import { summarizeJobs } from "@/lib/metrics";
import { requireV1Permission } from "@/lib/v1/auth";

export async function GET(request: Request) {
  const unauthorized = await requireV1Permission(request, "read_project");
  if (unauthorized) {
    return unauthorized;
  }

  const jobs = await listExtractionJobs();
  const summary = summarizeJobs(jobs);

  return NextResponse.json({ summary });
}
