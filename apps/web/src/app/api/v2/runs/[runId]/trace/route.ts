import { NextResponse } from "next/server";

import { getRunV2, listRunTraces } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ runId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { runId } = await params;
  const run = await getRunV2(runId);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: run.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const traces = await listRunTraces(runId);
  return NextResponse.json({ traces });
}
