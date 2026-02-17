import { NextResponse } from "next/server";
import { z } from "zod";

import { assignProjectMember, createProject, listProjects } from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

const createProjectSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).optional(),
  ownerEmail: z.string().email().optional(),
});

export async function GET(request: Request) {
  const auth = await requirePermission({
    request,
    permission: "read_project",
  });

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId") || undefined;
  const isActiveParam = url.searchParams.get("isActive");
  const isActive = isActiveParam ? isActiveParam === "true" : undefined;

  const projects = await listProjects({
    organizationId,
    isActive,
  });

  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const auth = await requirePermission({
    request,
    permission: "manage_project",
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = createProjectSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const project = await createProject({
      organizationId: parsed.data.organizationId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
      actor: auth.actor.email ?? undefined,
    });

    const ownerEmail = parsed.data.ownerEmail ?? auth.actor.email ?? "owner@flowstate.dev";

    await assignProjectMember({
      projectId: project.id,
      userEmail: ownerEmail,
      role: "owner",
      actor: auth.actor.email ?? undefined,
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create project" },
      { status: 404 },
    );
  }
}
