import { NextResponse } from "next/server";

import { deleteProject, getProject } from "@/lib/data-store-v2";
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

  const project = await getProject(projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ project });
}

export async function DELETE(request: Request, { params }: Params) {
  const { projectId } = await params;
  const project = await getProject(projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "manage_project",
    projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  await deleteProject({
    projectId,
    actor: auth.actor.email ?? undefined,
  });

  return new NextResponse(null, { status: 204 });
}
