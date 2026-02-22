import { NextResponse } from "next/server";

import { readProjectExportFile } from "@/lib/project-exports";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ projectId: string; exportId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { projectId, exportId } = await params;
  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId,
  });
  if (!auth.ok) {
    return auth.response;
  }

  const file = await readProjectExportFile(projectId, exportId);
  if (!file) {
    return NextResponse.json({ error: "Export not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${projectId}-${exportId}-${file.metadata.file_name}"`,
    },
  });
}
