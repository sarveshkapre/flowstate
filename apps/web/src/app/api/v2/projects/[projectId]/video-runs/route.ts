import { NextResponse } from "next/server";
import { z } from "zod";

import { createVideoRun, listVideoRuns } from "@/lib/v2/video-run-service";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ projectId: string }>;
};

const createVideoRunSchema = z.object({
  artifactId: z.string().min(1),
  targets: z.array(z.string().min(1)).min(1).max(20),
  mode: z.enum(["track_only", "track_speed"]).default("track_only"),
  qualityMode: z.enum(["fast", "balanced", "quality"]).default("balanced"),
  reasoningEffort: z.enum(["medium", "high"]).default("medium"),
  trimStartS: z.number().nonnegative().optional(),
  trimEndS: z.number().positive().optional(),
  fpsWork: z.number().int().positive().max(30).optional(),
  inferenceStrideFrames: z.number().int().positive().max(30).optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  speedEnabled: z.boolean().optional(),
  speedMode: z.enum(["relative", "calibrated"]).optional(),
  metersPerPixel: z.number().positive().optional(),
  calibrationReference: z
    .object({
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
      distanceM: z.number().positive(),
    })
    .optional(),
  trailsEnabled: z.boolean().optional(),
  trailFrames: z.number().int().nonnegative().max(60).optional(),
  maxDetectionsPerFrame: z.number().int().positive().max(200).optional(),
});

export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({ request, permission: "read_project", projectId });
  if (!auth.ok) {
    return auth.response;
  }

  const runs = await listVideoRuns(projectId);
  return NextResponse.json({
    runs: runs.map((run) => ({
      run_id: run.run_id,
      created_at: run.created_at,
      updated_at: run.updated_at,
      status: run.status,
      stage: run.stage,
      stage_progress: run.stage_progress,
      error: run.error,
      summary: run.summary,
    })),
  });
}

export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  const auth = await requirePermission({ request, permission: "run_flow", projectId });
  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = createVideoRunSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const run = await createVideoRun({
      projectId,
      artifactId: parsed.data.artifactId,
      targets: parsed.data.targets,
      mode: parsed.data.mode,
      qualityMode: parsed.data.qualityMode,
      reasoningEffort: parsed.data.reasoningEffort,
      trimStartS: parsed.data.trimStartS,
      trimEndS: parsed.data.trimEndS,
      fpsWork: parsed.data.fpsWork,
      inferenceStrideFrames: parsed.data.inferenceStrideFrames,
      confidenceThreshold: parsed.data.confidenceThreshold,
      speedEnabled: parsed.data.speedEnabled,
      speedMode: parsed.data.speedMode,
      metersPerPixel: parsed.data.metersPerPixel,
      calibrationReference: parsed.data.calibrationReference,
      trailsEnabled: parsed.data.trailsEnabled,
      trailFrames: parsed.data.trailFrames,
      maxDetectionsPerFrame: parsed.data.maxDetectionsPerFrame,
      actor: auth.actor.email ?? undefined,
    });

    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create video run." },
      { status: 500 },
    );
  }
}
