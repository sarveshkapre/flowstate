import { NextResponse } from "next/server";
import { requireV1Permission } from "@/lib/v1/auth";

export async function POST(request: Request) {
  const unauthorized = await requireV1Permission(request, "run_flow");
  if (unauthorized) {
    return unauthorized;
  }

  return NextResponse.json(
    {
      error: "This endpoint is deprecated.",
      message: "Use POST /api/v1/uploads and POST /api/v1/extractions instead.",
    },
    { status: 410 },
  );
}
