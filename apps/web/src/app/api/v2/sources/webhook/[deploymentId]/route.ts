import { NextResponse } from "next/server";

import { executeDeploymentByKey } from "@/lib/v2/flow-runtime";

type Params = {
  params: Promise<{ deploymentId: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { deploymentId } = await params;
  const payload = await request.json().catch(() => null);

  const result = await executeDeploymentByKey({
    deploymentKey: deploymentId,
    payload: payload ?? {},
  });

  if (!result) {
    return NextResponse.json({ error: "Deployment not found or inactive" }, { status: 404 });
  }

  return NextResponse.json({
    deployment: {
      id: result.deployment.id,
      flow_id: result.flow.id,
      flow_version_id: result.flowVersion.id,
    },
    run: result.run,
    output: result.output,
  });
}
