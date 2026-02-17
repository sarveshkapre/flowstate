import { NextResponse } from "next/server";
import { z } from "zod";

import { createDatasetVersion, getDataset, listDatasetVersions } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ datasetId: string }>;
};

const createDatasetVersionSchema = z.object({
  lines: z.array(z.string()).min(1),
});

export async function GET(request: Request, { params }: Params) {
  const { datasetId } = await params;
  const dataset = await getDataset(datasetId);

  if (!dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: dataset.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const versions = await listDatasetVersions(datasetId);
  return NextResponse.json({ versions });
}

export async function POST(request: Request, { params }: Params) {
  const { datasetId } = await params;
  const dataset = await getDataset(datasetId);

  if (!dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "create_flow",
    projectId: dataset.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = createDatasetVersionSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const version = await createDatasetVersion({
    datasetId,
    lines: parsed.data.lines,
    itemCount: parsed.data.lines.length,
    actor: auth.actor.email ?? undefined,
  });

  return NextResponse.json({ version }, { status: 201 });
}
