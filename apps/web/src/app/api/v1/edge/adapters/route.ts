import { NextResponse } from "next/server";

import { listEdgeAdapterDefinitions } from "@/lib/edge-adapters";

export async function GET() {
  return NextResponse.json({ adapters: listEdgeAdapterDefinitions() });
}
