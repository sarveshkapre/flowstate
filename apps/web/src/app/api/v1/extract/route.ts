import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "This endpoint is deprecated.",
      message: "Use POST /api/v1/uploads and POST /api/v1/extractions instead.",
    },
    { status: 410 },
  );
}
