import { NextResponse } from "next/server";

import { createArtifact, listArtifacts } from "@/lib/data-store";

const MAX_UPLOAD_BYTES = Number(process.env.FLOWSTATE_MAX_UPLOAD_BYTES || 20 * 1024 * 1024);

function isSupportedMimeType(mimeType: string) {
  return mimeType.startsWith("image/") || mimeType === "application/pdf";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  }

  const artifacts = await listArtifacts(limit);
  return NextResponse.json({ artifacts });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  if (!isSupportedMimeType(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use image/* or application/pdf." },
      { status: 400 },
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File too large. Max size is ${MAX_UPLOAD_BYTES} bytes.` },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  const artifact = await createArtifact({
    originalName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    bytes,
  });

  return NextResponse.json({
    artifact,
    file_url: `/api/v1/uploads/${artifact.id}/file`,
  });
}
