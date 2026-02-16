import { NextResponse } from "next/server";
import { reviewStatusSchema } from "@flowstate/types";

import { listExtractionJobs } from "@/lib/data-store";
import { extractionJobsToCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reviewStatus = url.searchParams.get("reviewStatus") || "approved";
  const reviewParsed = reviewStatusSchema.safeParse(reviewStatus);

  if (!reviewParsed.success) {
    return NextResponse.json({ error: "Invalid reviewStatus filter" }, { status: 400 });
  }

  const jobs = await listExtractionJobs({
    status: "completed",
    reviewStatus: reviewParsed.data,
  });

  const csv = extractionJobsToCsv(jobs);

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=\"flowstate-export-${reviewParsed.data}.csv\"`,
    },
  });
}
