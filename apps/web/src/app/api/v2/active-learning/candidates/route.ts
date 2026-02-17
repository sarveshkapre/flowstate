import { NextResponse } from "next/server";

import { listActiveLearningCandidatesV2 } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const auth = await requirePermission({ request, permission: "read_project", projectId });

  if (!auth.ok) {
    return auth.response;
  }

  const candidates = await listActiveLearningCandidatesV2({
    projectId,
    limit: Number.isFinite(limit) && typeof limit === "number" ? Math.min(limit, 200) : undefined,
  });

  return NextResponse.json({ candidates, count: candidates.length });
}
