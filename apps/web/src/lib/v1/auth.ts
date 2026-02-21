import type { Permission } from "@flowstate/types";
import { type NextResponse } from "next/server";

import { requirePermission } from "@/lib/v2/auth";

export async function requireV1Permission(request: Request, permission: Permission): Promise<NextResponse | null> {
  const auth = await requirePermission({
    request,
    permission,
  });

  if (!auth.ok) {
    return auth.response;
  }

  return null;
}
