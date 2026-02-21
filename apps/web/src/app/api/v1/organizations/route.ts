import { NextResponse } from "next/server";
import { z } from "zod";

import { createOrganization, listOrganizations } from "@/lib/data-store";
import { requireV1Permission } from "@/lib/v1/auth";

const createOrganizationSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(request: Request) {
  const unauthorized = await requireV1Permission(request, "read_project");
  if (unauthorized) {
    return unauthorized;
  }

  const organizations = await listOrganizations();
  return NextResponse.json({ organizations });
}

export async function POST(request: Request) {
  const unauthorized = await requireV1Permission(request, "manage_project");
  if (unauthorized) {
    return unauthorized;
  }

  const payload = await request.json().catch(() => null);
  const parsed = createOrganizationSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const organization = await createOrganization({
    name: parsed.data.name,
    slug: parsed.data.slug,
    isActive: parsed.data.isActive,
  });

  return NextResponse.json({ organization }, { status: 201 });
}
