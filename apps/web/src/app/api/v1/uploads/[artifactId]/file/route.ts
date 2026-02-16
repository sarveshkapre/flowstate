import { NextResponse } from "next/server";

import { readArtifactBytes } from "@/lib/data-store";

type Params = {
  params: Promise<{ artifactId: string }>;
};

export async function GET(_: Request, { params }: Params) {
  const { artifactId } = await params;
  const record = await readArtifactBytes(artifactId);

  if (!record) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(record.bytes), {
    headers: {
      "content-type": record.artifact.mime_type,
      "cache-control": "private, max-age=300",
      "content-disposition": `inline; filename=\"${record.artifact.original_name}\"`,
    },
  });
}
