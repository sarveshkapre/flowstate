import { NextResponse } from "next/server";

import { listAuditEvents } from "@/lib/data-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  }

  const events = await listAuditEvents({
    jobId,
    limit,
  });

  return NextResponse.json({ events });
}
