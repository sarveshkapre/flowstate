import { NextResponse } from "next/server";

import { getEdgeDeploymentBundle, readEdgeBundleContents } from "@/lib/data-store";

type Params = {
  params: Promise<{ bundleId: string }>;
};

export async function GET(_: Request, { params }: Params) {
  const { bundleId } = await params;
  const bundle = await getEdgeDeploymentBundle(bundleId);

  if (!bundle) {
    return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
  }

  const contents = await readEdgeBundleContents(bundle.file_name);

  if (!contents) {
    return NextResponse.json({ error: "Bundle file missing" }, { status: 404 });
  }

  return new NextResponse(contents, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename=\"${bundle.file_name}\"`,
      "cache-control": "no-store",
    },
  });
}
