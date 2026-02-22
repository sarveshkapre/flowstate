import { NextResponse } from "next/server";

import { deleteDataset, getDataset } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ datasetId: string }>;
};

export async function DELETE(request: Request, { params }: Params) {
  const { datasetId } = await params;
  const dataset = await getDataset(datasetId);

  if (!dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "manage_project",
    projectId: dataset.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  await deleteDataset({
    datasetId,
    actor: auth.actor.email ?? undefined,
  });

  return new NextResponse(null, { status: 204 });
}
