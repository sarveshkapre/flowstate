import { NextResponse } from "next/server";

import { listEdgeAdapterDefinitions } from "@/lib/edge-adapters";
import { requireV1Permission } from "@/lib/v1/auth";

export async function GET(request: Request) {
  const unauthorized = await requireV1Permission(request, "read_project");
  if (unauthorized) {
    return unauthorized;
  }

  return NextResponse.json({ adapters: listEdgeAdapterDefinitions() });
}
