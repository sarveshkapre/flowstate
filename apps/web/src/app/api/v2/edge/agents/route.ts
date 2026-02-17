import { NextResponse } from "next/server";

import { listEdgeAgents } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const agents = await listEdgeAgents(projectId);
  return NextResponse.json({ agents });
}
