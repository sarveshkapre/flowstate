import { NextResponse } from "next/server";
import { z } from "zod";

import { getWorkflow, listWorkflowRuns } from "@/lib/data-store";
import { runWorkflow } from "@/lib/workflow-service";
import { requireV1Permission } from "@/lib/v1/auth";

type Params = {
  params: Promise<{ workflowId: string }>;
};

const runWorkflowSchema = z.object({
  artifactId: z.string().uuid(),
});

export async function GET(request: Request, { params }: Params) {
  const unauthorized = await requireV1Permission(request, "read_project");
  if (unauthorized) {
    return unauthorized;
  }

  const { workflowId } = await params;

  const workflow = await getWorkflow(workflowId);

  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const runs = await listWorkflowRuns({ workflowId, limit: 50 });
  return NextResponse.json({ runs });
}

export async function POST(request: Request, { params }: Params) {
  const unauthorized = await requireV1Permission(request, "run_flow");
  if (unauthorized) {
    return unauthorized;
  }

  const { workflowId } = await params;
  const workflow = await getWorkflow(workflowId);

  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = runWorkflowSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await runWorkflow({
    workflowId,
    artifactId: parsed.data.artifactId,
  });

  if (!result.run) {
    return NextResponse.json({ error: "Workflow is inactive or unavailable" }, { status: 409 });
  }

  return NextResponse.json({ run: result.run, extractionJob: result.extractionJob }, { status: 201 });
}
