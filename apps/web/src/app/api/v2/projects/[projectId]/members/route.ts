import { NextResponse } from "next/server";
import { projectMemberRoleSchema } from "@flowstate/types";
import { z } from "zod";

import { assignProjectMember, listProjectMembers } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ projectId: string }>;
};

const assignMemberSchema = z.object({
  userEmail: z.string().email(),
  role: projectMemberRoleSchema,
});

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

  const members = await listProjectMembers(projectId);
  return NextResponse.json({ members });
}

export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({
    request,
    permission: "manage_members",
    projectId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = assignMemberSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const member = await assignProjectMember({
      projectId,
      userEmail: parsed.data.userEmail,
      role: parsed.data.role,
      actor: auth.actor.email ?? undefined,
    });

    return NextResponse.json({ member });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to assign member" },
      { status: 404 },
    );
  }
}
