import { NextResponse } from "next/server";
import { z } from "zod";

import { createDataset, listDatasets } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

const createDatasetSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(160),
  description: z.string().max(4000).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const auth = await requirePermission({ request, permission: "read_project", projectId });

  if (!auth.ok) {
    return auth.response;
  }

  const datasets = await listDatasets(projectId);
  return NextResponse.json({ datasets });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = createDatasetSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requirePermission({
    request,
    permission: "create_flow",
    projectId: parsed.data.projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const dataset = await createDataset({
    projectId: parsed.data.projectId,
    name: parsed.data.name,
    description: parsed.data.description,
    actor: auth.actor.email ?? undefined,
  });

  return NextResponse.json({ dataset }, { status: 201 });
}
