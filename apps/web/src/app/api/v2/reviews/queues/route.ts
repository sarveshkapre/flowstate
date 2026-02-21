import { NextResponse } from "next/server";
import { z } from "zod";

import { listReviewQueuesV2 } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

const querySchema = z.object({
  projectId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  staleHours: z.coerce.number().positive().max(24 * 30).default(24),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    projectId: url.searchParams.get("projectId"),
    limit: url.searchParams.get("limit") || undefined,
    staleHours: url.searchParams.get("staleHours") || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query params", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: parsed.data.projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const staleAfterMs = Math.floor(parsed.data.staleHours * 60 * 60 * 1000);
  const result = await listReviewQueuesV2({
    projectId: parsed.data.projectId,
    limit: parsed.data.limit,
    staleAfterMs,
  });

  return NextResponse.json({
    project_id: parsed.data.projectId,
    stale_hours: parsed.data.staleHours,
    summary: result.summary,
    queues: result.queues,
  });
}
