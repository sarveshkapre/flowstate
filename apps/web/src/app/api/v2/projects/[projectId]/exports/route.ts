import { NextResponse } from "next/server";

import { createProjectCocoExport, listProjectExports } from "@/lib/project-exports";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId,
  });
  if (!auth.ok) {
    return auth.response;
  }

  const exports = await listProjectExports(projectId);
  return NextResponse.json({ exports });
}

export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId,
  });
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const created = await createProjectCocoExport(projectId);
    return NextResponse.json({ export: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create export." },
      { status: 500 },
    );
  }
}
