import { NextResponse } from "next/server";
import { z } from "zod";

import { getDataset, listUploadScanJobsByProject } from "@/lib/data-store-v2";
import { enqueueUploadScanJob, processUploadScanJob } from "@/lib/upload-scan-job-service";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ projectId: string }>;
};

const createUploadJobSchema = z.object({
  datasetId: z.string().min(1),
  batchName: z.string().min(1).max(160),
  sourceType: z.enum(["image", "video", "mixed"]),
  sourceArtifactIds: z.array(z.string().min(1)).min(1).max(500),
  reasoningEffort: z.enum(["low", "medium", "high"]).default("medium"),
  scanPrompt: z.string().max(3000).optional(),
  qualityMode: z.enum(["fast", "dense"]).default("dense"),
  maxObjects: z.number().int().positive().max(1000).optional(),
});

export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId,
  });
  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  if (limitParam && (!Number.isFinite(limit) || Number(limit) <= 0)) {
    return NextResponse.json({ error: "Invalid limit query parameter" }, { status: 400 });
  }

  const jobs = await listUploadScanJobsByProject({
    projectId,
    limit,
  });

  for (const job of jobs) {
    if (job.status === "queued") {
      void processUploadScanJob(job.id);
    }
  }

  return NextResponse.json({ jobs });
}

export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({
    request,
    permission: "run_flow",
    projectId,
  });
  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = createUploadJobSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const dataset = await getDataset(parsed.data.datasetId);
  if (!dataset || dataset.project_id !== projectId) {
    return NextResponse.json({ error: "Dataset not found in this project" }, { status: 404 });
  }

  try {
    const job = await enqueueUploadScanJob({
      projectId,
      datasetId: parsed.data.datasetId,
      batchName: parsed.data.batchName,
      sourceType: parsed.data.sourceType,
      sourceArtifactIds: parsed.data.sourceArtifactIds,
      reasoningEffort: parsed.data.reasoningEffort,
      scanPrompt: parsed.data.scanPrompt,
      qualityMode: parsed.data.qualityMode,
      maxObjects: parsed.data.maxObjects,
      actor: auth.actor.email ?? undefined,
    });

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start upload job.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
