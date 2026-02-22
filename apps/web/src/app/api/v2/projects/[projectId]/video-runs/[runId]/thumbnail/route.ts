import { NextResponse } from "next/server";

import { readVideoRunFile } from "@/lib/v2/video-run-service";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ projectId: string; runId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { projectId, runId } = await params;
  const auth = await requirePermission({ request, permission: "read_project", projectId });
  if (!auth.ok) {
    return auth.response;
  }

  const file = await readVideoRunFile({ projectId, runId, kind: "thumbnail" });
  if (!file) {
    return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.contentType,
      "cache-control": "private, max-age=300",
      "content-disposition": `inline; filename="${file.fileName}"`,
    },
  });
}
