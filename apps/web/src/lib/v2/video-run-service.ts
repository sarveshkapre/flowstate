import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { resolveArtifactFilePath } from "../data-store.ts";
import { getProject } from "../data-store-v2.ts";
import { resolveOpenAIModel } from "../openai-model.ts";
import { createResponseWithReasoningFallback } from "../openai-responses.ts";
import { getOpenAIClient } from "../openai.ts";

const execFile = promisify(execFileCallback);
const COMMAND_BUFFER_SIZE = 16 * 1024 * 1024;
const WORKSPACE_ROOT = path.resolve(process.cwd(), "../..");
const DATA_DIR = process.env.FLOWSTATE_DATA_DIR
  ? path.resolve(process.env.FLOWSTATE_DATA_DIR)
  : path.join(WORKSPACE_ROOT, ".flowstate-data");
const LOCAL_PROJECTS_DIR = path.join(DATA_DIR, "local-projects");
const VIDEO_RUNS_DIR_NAME = "video-runs";
const DEFAULT_TRIM_SECONDS = 2;
const DEFAULT_TRAIL_FRAMES = 20;

export type VideoRunStatus = "processing" | "done" | "failed";
export type VideoRunStage =
  | "queued"
  | "extracting_frames"
  | "detecting_keyframes"
  | "tracking"
  | "rendering"
  | "completed"
  | "failed";
export type VideoRunMode = "track_only" | "track_speed";
export type VideoSpeedMode = "relative" | "calibrated";
export type VideoReasoningEffort = "low" | "medium" | "high";
export type VideoQualityMode = "fast" | "balanced" | "quality";

const videoRunTrackFrameVelocitySchema = z.object({
  px_per_s: z.tuple([z.number(), z.number()]),
  speed_px_per_s: z.number().nonnegative(),
  m_per_s: z.tuple([z.number(), z.number()]).nullable(),
  speed_m_per_s: z.number().nonnegative().nullable(),
  km_per_h: z.number().nonnegative().nullable(),
  smoothed: z.boolean(),
});

const videoRunTrackFrameSchema = z.object({
  frame_index: z.number().int().nonnegative(),
  t_s: z.number().nonnegative(),
  bbox_xywh: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  confidence: z.number().min(0).max(1).nullable(),
  is_keyframe_detection: z.boolean(),
  velocity: videoRunTrackFrameVelocitySchema,
});

const videoRunTrackSchema = z.object({
  track_id: z.number().int().positive(),
  class_id: z.number().int().positive(),
  label: z.string().min(1),
  source: z.string().min(1),
  summary: z.object({
    first_frame: z.number().int().nonnegative(),
    last_frame: z.number().int().nonnegative(),
    num_frames: z.number().int().nonnegative(),
    avg_confidence: z.number().min(0).max(1).nullable(),
    id_switches: z.number().int().nonnegative(),
    missed_frames: z.number().int().nonnegative(),
  }),
  frames: z.array(videoRunTrackFrameSchema),
});

const tracksFileSchema = z.object({
  schema_version: z.literal("1.0"),
  run_id: z.string().min(1),
  video: z.object({
    filename: z.string().min(1),
    sha256: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps_input: z.number().positive(),
    fps_work: z.number().positive(),
    duration_s: z.number().nonnegative(),
    trim: z.object({
      start_s: z.number().nonnegative(),
      end_s: z.number().nonnegative(),
    }),
  }),
  classes: z.array(
    z.object({
      class_id: z.number().int().positive(),
      name: z.string().min(1),
    }),
  ),
  tracks: z.array(videoRunTrackSchema),
  frame_index: z.array(
    z.object({
      frame_index: z.number().int().nonnegative(),
      t_s: z.number().nonnegative(),
      detections: z.array(
        z.object({
          track_id: z.number().int().positive(),
          class_id: z.number().int().positive(),
          bbox_xywh: z.tuple([z.number(), z.number(), z.number(), z.number()]),
          confidence: z.number().min(0).max(1).nullable(),
        }),
      ),
    }),
  ),
});

const runMetadataSchema = z.object({
  schema_version: z.literal("1.0"),
  run_id: z.string().min(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  status: z.enum(["processing", "done", "failed"]),
  stage: z.enum(["queued", "extracting_frames", "detecting_keyframes", "tracking", "rendering", "completed", "failed"]),
  stage_progress: z.number().min(0).max(1).nullable(),
  error: z.string().nullable(),
  summary: z
    .object({
      targets: z.array(z.string()),
      mode: z.enum(["track_only", "track_speed"]),
      quality_mode: z.enum(["fast", "balanced", "quality"]),
      speed_mode: z.enum(["relative", "calibrated"]),
      duration_s: z.number().nonnegative().nullable(),
      frame_count: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  project: z.object({
    project_id: z.string().min(1),
    project_name: z.string().min(1),
    project_path: z.string().min(1),
  }),
  input: z.object({
    artifact_id: z.string().min(1),
    video_path: z.string().min(1),
    video_filename: z.string().min(1),
    video_sha256: z.string().min(1),
  }),
  processing: z.object({
    trim: z.object({ start_s: z.number().nonnegative(), end_s: z.number().nonnegative() }),
    fps_work: z.number().positive(),
    frame_count: z.number().int().nonnegative(),
    inference_stride_frames: z.number().int().positive(),
    confidence_threshold: z.number().min(0).max(1),
    max_detections_per_frame: z.number().int().positive(),
    targets: z.array(z.object({ class_id: z.number().int().positive(), name: z.string().min(1) })),
    presets: z.object({ quality_mode: z.enum(["fast", "balanced", "quality"]) }),
  }),
  tracking: z.object({
    tracker_name: z.literal("flowstate_iou_linear"),
    params: z.object({
      iou_match_threshold: z.number().min(0).max(1),
      max_age_frames: z.number().int().positive(),
      min_hits: z.number().int().nonnegative(),
    }),
    smoothing: z.object({
      enabled: z.boolean(),
      method: z.literal("moving_average"),
      window_frames: z.number().int().positive(),
    }),
  }),
  speed: z.object({
    enabled: z.boolean(),
    mode: z.enum(["relative", "calibrated"]),
    calibration: z.object({
      enabled: z.boolean(),
      method: z.enum(["meters_per_pixel", "two_point_reference"]).nullable(),
      meters_per_pixel: z.number().positive().nullable(),
      reference: z
        .object({
          x1: z.number(),
          y1: z.number(),
          x2: z.number(),
          y2: z.number(),
          distance_m: z.number().positive(),
        })
        .nullable(),
    }),
  }),
  openai: z.object({
    enabled: z.boolean(),
    purpose: z.literal("keyframe_detection"),
    model: z.string().min(1),
    reasoning_effort: z.enum(["low", "medium", "high"]),
    requests: z.object({
      num_images_sent: z.number().int().nonnegative(),
      estimated_total_tokens: z.number().int().nonnegative().nullable(),
    }),
    prompt_fingerprint: z.string().min(1),
  }),
  outputs: z.object({
    tracks_json_path: z.string().min(1),
    run_metadata_path: z.string().min(1),
    annotated_video_path: z.string().nullable(),
    work_video_path: z.string().nullable(),
    preview_thumbnail_path: z.string().nullable(),
  }),
  ops_history: z.array(
    z.object({
      op_id: z.string().min(1),
      type: z.string().min(1),
      command: z.string().min(1),
      scope: z.string().min(1),
      applied: z.boolean(),
      diff_summary: z.object({
        tracks_affected: z.number().int().nonnegative(),
        frames_affected: z.number().int().nonnegative(),
        boxes_removed: z.number().int().nonnegative(),
        boxes_modified: z.number().int().nonnegative(),
      }),
    }),
  ),
});

export type VideoRunMetadata = z.infer<typeof runMetadataSchema>;
export type VideoRunTracksFile = z.infer<typeof tracksFileSchema>;

export type CreateVideoRunInput = {
  projectId: string;
  artifactId: string;
  actor?: string;
  targets: string[];
  mode: VideoRunMode;
  qualityMode: VideoQualityMode;
  reasoningEffort: VideoReasoningEffort;
  trimStartS?: number;
  trimEndS?: number;
  fpsWork?: number;
  inferenceStrideFrames?: number;
  confidenceThreshold?: number;
  speedEnabled?: boolean;
  speedMode?: VideoSpeedMode;
  metersPerPixel?: number | null;
  calibrationReference?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    distanceM: number;
  } | null;
  trailsEnabled?: boolean;
  trailFrames?: number;
  maxDetectionsPerFrame?: number;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

type VideoProbe = {
  width: number;
  height: number;
  durationS: number;
  fps: number;
  frameCount: number | null;
};

type Detection = {
  label: string;
  confidence: number | null;
  bbox: BBox;
};

type BBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type KeyframeState = {
  frameIndex: number;
  tS: number;
  bbox: BBox;
  confidence: number | null;
  isKeyframeDetection: boolean;
};

type Track = {
  trackId: number;
  label: string;
  frames: KeyframeState[];
};

type ProcessingConfig = {
  trimStartS: number;
  trimEndS: number;
  fpsWork: number;
  inferenceStrideFrames: number;
  confidenceThreshold: number;
  maxDetectionsPerFrame: number;
  speedEnabled: boolean;
  speedMode: VideoSpeedMode;
  metersPerPixel: number | null;
  calibrationReference: CreateVideoRunInput["calibrationReference"];
  trailsEnabled: boolean;
  trailFrames: number;
  mode: VideoRunMode;
  qualityMode: VideoQualityMode;
  reasoningEffort: VideoReasoningEffort;
  targets: string[];
};

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function normalizeExecErrorMessage(command: string, error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  ) {
    return `${command} binary is not available on PATH`;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return `${command} failed`;
}

function defaultCommandRunner(command: string, args: string[]) {
  return execFile(command, args, { encoding: "utf8", maxBuffer: COMMAND_BUFFER_SIZE });
}

async function runCommand(command: string, args: string[], runImpl: CommandRunner = defaultCommandRunner) {
  try {
    return await runImpl(command, args);
  } catch (error) {
    throw new Error(normalizeExecErrorMessage(command, error));
  }
}

function projectDir(projectId: string) {
  return path.join(LOCAL_PROJECTS_DIR, projectId);
}

function projectVideoRunsDir(projectId: string) {
  return path.join(projectDir(projectId), VIDEO_RUNS_DIR_NAME);
}

function runDir(projectId: string, runId: string) {
  return path.join(projectVideoRunsDir(projectId), runId);
}

function runFramesDir(projectId: string, runId: string) {
  return path.join(runDir(projectId, runId), "frames");
}

function runAnnotatedFramesDir(projectId: string, runId: string) {
  return path.join(runDir(projectId, runId), "frames-annotated");
}

function runMetadataPath(projectId: string, runId: string) {
  return path.join(runDir(projectId, runId), "run_metadata.json");
}

function runTracksPath(projectId: string, runId: string) {
  return path.join(runDir(projectId, runId), "tracks.json");
}

function runWorkVideoPath(projectId: string, runId: string) {
  return path.join(runDir(projectId, runId), "work.mp4");
}

function runAnnotatedVideoPath(projectId: string, runId: string) {
  return path.join(runDir(projectId, runId), "annotated.mp4");
}

function runThumbnailPath(projectId: string, runId: string) {
  return path.join(runDir(projectId, runId), "thumb.jpg");
}

function relFromDataDir(filePath: string) {
  const relative = path.relative(DATA_DIR, filePath).split(path.sep).join("/");
  return relative;
}

function parseFraction(input: unknown): number | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed || trimmed === "0/0") {
    return null;
  }
  const [left, right] = trimmed.split("/");
  if (!left || !right) {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  const numerator = Number(left);
  const denominator = Number(right);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  const value = numerator / denominator;
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function probeVideo(videoPath: string): Promise<VideoProbe> {
  const result = await runCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,nb_frames,avg_frame_rate,r_frame_rate",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    videoPath,
  ]);

  const parsed = JSON.parse(result.stdout) as {
    streams?: Array<{
      width?: unknown;
      height?: unknown;
      nb_frames?: unknown;
      avg_frame_rate?: unknown;
      r_frame_rate?: unknown;
    }>;
    format?: { duration?: unknown };
  };
  const stream = parsed.streams?.[0];
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  const durationS = Number(parsed.format?.duration);
  const fps =
    parseFraction(stream?.avg_frame_rate) ??
    parseFraction(stream?.r_frame_rate) ??
    0;
  const frameCount = Number(stream?.nb_frames);

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("Unable to determine video dimensions.");
  }

  return {
    width: Math.floor(width),
    height: Math.floor(height),
    durationS: Number.isFinite(durationS) && durationS > 0 ? durationS : 0,
    fps: fps > 0 ? fps : 1,
    frameCount: Number.isFinite(frameCount) && frameCount > 0 ? Math.floor(frameCount) : null,
  };
}

async function sha256OfFile(filePath: string) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeLabel(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeTargets(targets: string[]) {
  const expanded = targets.flatMap((target) => {
    const normalized = normalizeLabel(target);
    if (!normalized) {
      return [];
    }
    if (normalized === "people" || normalized === "person") {
      return ["person"];
    }
    if (normalized === "cars" || normalized === "car") {
      return ["car"];
    }
    if (normalized === "balls" || normalized === "ball") {
      return ["ball"];
    }
    return [normalized];
  });
  return [...new Set(expanded)];
}

function qualityDefaults(mode: VideoQualityMode) {
  if (mode === "fast") {
    return { fpsWork: 10, inferenceStrideFrames: 10, confidenceThreshold: 0.4 };
  }
  if (mode === "quality") {
    return { fpsWork: 15, inferenceStrideFrames: 5, confidenceThreshold: 0.3 };
  }
  return { fpsWork: 12, inferenceStrideFrames: 6, confidenceThreshold: 0.35 };
}

function resolveProcessingConfig(input: CreateVideoRunInput): ProcessingConfig {
  const defaults = qualityDefaults(input.qualityMode);
  const targets = normalizeTargets(input.targets);
  const trimStartS =
    typeof input.trimStartS === "number" && Number.isFinite(input.trimStartS)
      ? Math.max(0, input.trimStartS)
      : 0;
  const requestedTrimEndS =
    typeof input.trimEndS === "number" && Number.isFinite(input.trimEndS)
      ? Math.max(0, input.trimEndS)
      : trimStartS + DEFAULT_TRIM_SECONDS;
  const trimEndS = Math.min(requestedTrimEndS, trimStartS + DEFAULT_TRIM_SECONDS);

  const reference = input.calibrationReference;
  let computedMetersPerPixel =
    typeof input.metersPerPixel === "number" && Number.isFinite(input.metersPerPixel) && input.metersPerPixel > 0
      ? input.metersPerPixel
      : null;

  if (
    !computedMetersPerPixel &&
    reference &&
    Number.isFinite(reference.distanceM) &&
    reference.distanceM > 0
  ) {
    const dx = reference.x2 - reference.x1;
    const dy = reference.y2 - reference.y1;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    if (pixelDistance > 0) {
      computedMetersPerPixel = reference.distanceM / pixelDistance;
    }
  }

  return {
    trimStartS,
    trimEndS,
    fpsWork:
      typeof input.fpsWork === "number" && Number.isFinite(input.fpsWork)
        ? clamp(Math.round(input.fpsWork), 6, 30)
        : defaults.fpsWork,
    inferenceStrideFrames:
      typeof input.inferenceStrideFrames === "number" && Number.isFinite(input.inferenceStrideFrames)
        ? clamp(Math.round(input.inferenceStrideFrames), 1, 30)
        : defaults.inferenceStrideFrames,
    confidenceThreshold:
      typeof input.confidenceThreshold === "number" && Number.isFinite(input.confidenceThreshold)
        ? clamp(input.confidenceThreshold, 0, 1)
        : defaults.confidenceThreshold,
    maxDetectionsPerFrame:
      typeof input.maxDetectionsPerFrame === "number" && Number.isFinite(input.maxDetectionsPerFrame)
        ? clamp(Math.round(input.maxDetectionsPerFrame), 1, 200)
        : 50,
    speedEnabled: input.speedEnabled ?? input.mode === "track_speed",
    speedMode: input.speedMode ?? "relative",
    metersPerPixel: computedMetersPerPixel,
    calibrationReference: input.calibrationReference ?? null,
    trailsEnabled: input.trailsEnabled ?? true,
    trailFrames:
      typeof input.trailFrames === "number" && Number.isFinite(input.trailFrames)
        ? clamp(Math.round(input.trailFrames), 0, 60)
        : DEFAULT_TRAIL_FRAMES,
    mode: input.mode,
    qualityMode: input.qualityMode,
    reasoningEffort: input.reasoningEffort,
    targets,
  };
}

async function nextRunId(projectId: string) {
  const dir = projectVideoRunsDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  let max = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const match = /^run_(\d{4})$/.exec(entry.name);
    if (!match) {
      continue;
    }
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) {
      max = Math.max(max, parsed);
    }
  }
  return `run_${String(max + 1).padStart(4, "0")}`;
}

async function writeMetadata(metadata: VideoRunMetadata) {
  await fs.writeFile(
    runMetadataPath(metadata.project.project_id, metadata.run_id),
    JSON.stringify(metadata, null, 2),
    "utf8",
  );
}

async function readMetadata(projectId: string, runId: string): Promise<VideoRunMetadata | null> {
  try {
    const text = await fs.readFile(runMetadataPath(projectId, runId), "utf8");
    return runMetadataSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

async function patchMetadata(
  projectId: string,
  runId: string,
  update: Partial<Pick<VideoRunMetadata, "status" | "stage" | "stage_progress" | "error" | "updated_at" | "summary" | "openai" | "processing" | "outputs" | "speed" | "tracking">>,
) {
  const current = await readMetadata(projectId, runId);
  if (!current) {
    return null;
  }

  const merged = runMetadataSchema.parse({
    ...current,
    ...update,
    updated_at: new Date().toISOString(),
  });
  await writeMetadata(merged);
  return merged;
}

function frameFileName(frameIndex: number) {
  return `frame-${String(frameIndex + 1).padStart(6, "0")}.jpg`;
}

async function listFrameFiles(framesDir: string) {
  const entries = await fs.readdir(framesDir);
  return entries
    .filter((name) => name.toLowerCase().endsWith(".jpg"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(framesDir, name));
}

function iou(left: BBox, right: BBox) {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const intersectionW = Math.max(0, x2 - x1);
  const intersectionH = Math.max(0, y2 - y1);
  const intersection = intersectionW * intersectionH;
  const leftArea = Math.max(0, left.width) * Math.max(0, left.height);
  const rightArea = Math.max(0, right.width) * Math.max(0, right.height);
  const union = leftArea + rightArea - intersection;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}

function lerp(left: number, right: number, ratio: number) {
  return left + (right - left) * ratio;
}

function centerOf(bbox: BBox) {
  return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
}

const detectionSchema = z.object({
  objects: z.array(
    z.object({
      label: z.string().min(1),
      confidence: z.number().min(0).max(1).nullable(),
      bbox: z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0).max(1),
        height: z.number().min(0).max(1),
      }),
    }),
  ),
});

async function detectObjectsOnFrame(input: {
  framePath: string;
  targets: string[];
  reasoningEffort: VideoReasoningEffort;
  confidenceThreshold: number;
  maxDetectionsPerFrame: number;
  width: number;
  height: number;
}): Promise<Detection[]> {
  const bytes = await fs.readFile(input.framePath);
  const base64Image = bytes.toString("base64");
  const model = resolveOpenAIModel();
  const prompt = [
    "You are a data labeling expert for computer vision tracking tasks.",
    `Detect only these classes: ${input.targets.join(", ")}.`,
    "Return one object entry per visible instance.",
    "Return normalized bbox values in [0,1] as x,y,width,height.",
    "Confidence should be a number in [0,1] or null.",
  ].join("\n");

  const openai = getOpenAIClient();
  const response = await createResponseWithReasoningFallback(openai, {
    model,
    reasoning: {
      effort: input.reasoningEffort,
    },
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: "You perform object detection for short video keyframes." }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: `data:image/jpeg;base64,${base64Image}`, detail: "high" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "video_keyframe_detections",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            objects: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: { type: "string" },
                  confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
                  bbox: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      x: { type: "number", minimum: 0, maximum: 1 },
                      y: { type: "number", minimum: 0, maximum: 1 },
                      width: { type: "number", minimum: 0, maximum: 1 },
                      height: { type: "number", minimum: 0, maximum: 1 },
                    },
                    required: ["x", "y", "width", "height"],
                  },
                },
                required: ["label", "bbox", "confidence"],
              },
            },
          },
          required: ["objects"],
        },
        strict: true,
      },
    },
  });

  const output = response.output_text?.trim() || "{}";
  const parsed = detectionSchema.parse(JSON.parse(output));
  const allowed = new Set(input.targets);

  return parsed.objects
    .map((item) => {
      const normalized = normalizeLabel(item.label);
      return {
        label: normalized,
        confidence: item.confidence,
        bbox: {
          x: clamp(item.bbox.x, 0, 1) * input.width,
          y: clamp(item.bbox.y, 0, 1) * input.height,
          width: clamp(item.bbox.width, 0, 1) * input.width,
          height: clamp(item.bbox.height, 0, 1) * input.height,
        },
      } satisfies Detection;
    })
    .filter((item) => item.label && allowed.has(item.label))
    .filter((item) => (item.confidence ?? 1) >= input.confidenceThreshold)
    .slice(0, input.maxDetectionsPerFrame);
}

function buildTracks(input: {
  detectionsByFrame: Map<number, Detection[]>;
  frameCount: number;
  fpsWork: number;
  inferenceStrideFrames: number;
  iouThreshold: number;
}) {
  let nextTrackId = 1;
  const active = new Map<number, { label: string; frameIndex: number; bbox: BBox }>();
  const keyframes = [...input.detectionsByFrame.keys()].sort((a, b) => a - b);
  const perTrackKeyframes = new Map<number, KeyframeState[]>();
  const maxAgeFrames = Math.max(input.inferenceStrideFrames * 2, 2);

  for (const frameIndex of keyframes) {
    const detections = [...(input.detectionsByFrame.get(frameIndex) ?? [])].sort(
      (left, right) => (right.confidence ?? 0) - (left.confidence ?? 0),
    );
    const usedTrackIds = new Set<number>();

    for (const detection of detections) {
      let bestTrackId: number | null = null;
      let bestScore = 0;

      for (const [trackId, candidate] of active.entries()) {
        if (candidate.label !== detection.label) {
          continue;
        }
        if (usedTrackIds.has(trackId)) {
          continue;
        }
        if (frameIndex - candidate.frameIndex > maxAgeFrames) {
          continue;
        }
        const score = iou(candidate.bbox, detection.bbox);
        if (score > bestScore) {
          bestScore = score;
          bestTrackId = trackId;
        }
      }

      const trackId = bestTrackId && bestScore >= input.iouThreshold ? bestTrackId : nextTrackId++;
      usedTrackIds.add(trackId);
      active.set(trackId, { label: detection.label, frameIndex, bbox: detection.bbox });

      const list = perTrackKeyframes.get(trackId) ?? [];
      list.push({
        frameIndex,
        tS: frameIndex / input.fpsWork,
        bbox: detection.bbox,
        confidence: detection.confidence,
        isKeyframeDetection: true,
      });
      perTrackKeyframes.set(trackId, list);
    }
  }

  const tracks: Track[] = [];
  for (const [trackId, states] of perTrackKeyframes.entries()) {
    const sorted = [...states].sort((left, right) => left.frameIndex - right.frameIndex);
    if (sorted.length === 0) {
      continue;
    }

    const expanded: KeyframeState[] = [];
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index]!;
      if (index === 0) {
        expanded.push(current);
      }

      const next = sorted[index + 1];
      if (!next) {
        continue;
      }

      const gap = next.frameIndex - current.frameIndex;
      for (let frame = current.frameIndex + 1; frame < next.frameIndex; frame += 1) {
        const ratio = (frame - current.frameIndex) / gap;
        expanded.push({
          frameIndex: frame,
          tS: frame / input.fpsWork,
          bbox: {
            x: lerp(current.bbox.x, next.bbox.x, ratio),
            y: lerp(current.bbox.y, next.bbox.y, ratio),
            width: lerp(current.bbox.width, next.bbox.width, ratio),
            height: lerp(current.bbox.height, next.bbox.height, ratio),
          },
          confidence: current.confidence ?? next.confidence ?? null,
          isKeyframeDetection: false,
        });
      }
      expanded.push(next);
    }

    const label = normalizeLabel(active.get(trackId)?.label ?? "object") || "object";
    tracks.push({
      trackId,
      label,
      frames: expanded
        .filter((state) => state.frameIndex >= 0 && state.frameIndex < input.frameCount)
        .sort((left, right) => left.frameIndex - right.frameIndex),
    });
  }

  tracks.sort((left, right) => left.trackId - right.trackId);
  return { tracks, maxAgeFrames };
}

function movingAverage(values: number[], windowSize: number) {
  const next: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1);
    const sum = slice.reduce((acc, item) => acc + item, 0);
    next.push(sum / slice.length);
  }
  return next;
}

function attachVelocity(input: {
  tracks: Track[];
  fpsWork: number;
  speedEnabled: boolean;
  speedMode: VideoSpeedMode;
  metersPerPixel: number | null;
  smoothingWindowFrames: number;
}) {
  const dt = input.fpsWork > 0 ? 1 / input.fpsWork : 1 / 12;

  return input.tracks.map((track) => {
    const centers = track.frames.map((frame) => centerOf(frame.bbox));
    const rawVx = centers.map((center, index) => {
      if (index === 0) {
        return 0;
      }
      return (center.x - centers[index - 1]!.x) / dt;
    });
    const rawVy = centers.map((center, index) => {
      if (index === 0) {
        return 0;
      }
      return (center.y - centers[index - 1]!.y) / dt;
    });
    const smoothVx = movingAverage(rawVx, input.smoothingWindowFrames);
    const smoothVy = movingAverage(rawVy, input.smoothingWindowFrames);

    const frames = track.frames.map((frame, index) => {
      const vx = smoothVx[index] ?? 0;
      const vy = smoothVy[index] ?? 0;
      const speedPx = Math.sqrt(vx * vx + vy * vy);
      const canUseMeters = input.speedEnabled && input.speedMode === "calibrated" && (input.metersPerPixel ?? 0) > 0;
      const metersPerPixel = canUseMeters ? (input.metersPerPixel as number) : null;
      const vxM = metersPerPixel == null ? null : vx * metersPerPixel;
      const vyM = metersPerPixel == null ? null : vy * metersPerPixel;
      const speedM = metersPerPixel == null ? null : speedPx * metersPerPixel;
      return {
        ...frame,
        velocity: {
          px_per_s: [vx, vy] as [number, number],
          speed_px_per_s: speedPx,
          m_per_s: vxM == null || vyM == null ? null : ([vxM, vyM] as [number, number]),
          speed_m_per_s: speedM,
          km_per_h: speedM == null ? null : speedM * 3.6,
          smoothed: true,
        },
      };
    });

    return { ...track, frames };
  });
}

function colorForTrack(trackId: number) {
  const palette = ["00ff88", "00d2ff", "ffc400", "ff6b6b", "8f7bff", "6ee7b7", "f97316"];
  return palette[(trackId - 1) % palette.length]!;
}

function escapeDrawText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,");
}

function frameStatesByTrack(track: Track & { frames: Array<KeyframeState & { velocity: z.infer<typeof videoRunTrackFrameVelocitySchema> }> }) {
  const map = new Map<number, KeyframeState & { velocity: z.infer<typeof videoRunTrackFrameVelocitySchema> }>();
  for (const frame of track.frames) {
    map.set(frame.frameIndex, frame);
  }
  return map;
}

async function renderAnnotatedFrames(input: {
  projectId: string;
  runId: string;
  width: number;
  height: number;
  fpsWork: number;
  tracks: Array<Track & { frames: Array<KeyframeState & { velocity: z.infer<typeof videoRunTrackFrameVelocitySchema> }> }>;
  showSpeed: boolean;
  trailsEnabled: boolean;
  trailFrames: number;
}) {
  const rawFramesDir = runFramesDir(input.projectId, input.runId);
  const annotatedDir = runAnnotatedFramesDir(input.projectId, input.runId);
  await fs.rm(annotatedDir, { recursive: true, force: true });
  await fs.mkdir(annotatedDir, { recursive: true });

  const rawFrameFiles = await listFrameFiles(rawFramesDir);
  const byFrame = new Map<number, Array<{ trackId: number; label: string; frame: KeyframeState & { velocity: z.infer<typeof videoRunTrackFrameVelocitySchema> } }>>();
  const perTrackIndex = new Map<number, Map<number, KeyframeState & { velocity: z.infer<typeof videoRunTrackFrameVelocitySchema> }>>();

  for (const track of input.tracks) {
    perTrackIndex.set(track.trackId, frameStatesByTrack(track));
    for (const frame of track.frames) {
      const list = byFrame.get(frame.frameIndex) ?? [];
      list.push({ trackId: track.trackId, label: track.label, frame });
      byFrame.set(frame.frameIndex, list);
    }
  }

  for (const [index, sourceFrame] of rawFrameFiles.entries()) {
    const overlays = byFrame.get(index) ?? [];
    if (overlays.length === 0) {
      await fs.copyFile(sourceFrame, path.join(annotatedDir, frameFileName(index)));
      continue;
    }

    const filters: string[] = [];
    for (const overlay of overlays) {
      const color = colorForTrack(overlay.trackId);
      const x = Math.max(0, Math.min(input.width - 1, overlay.frame.bbox.x));
      const y = Math.max(0, Math.min(input.height - 1, overlay.frame.bbox.y));
      const w = Math.max(1, Math.min(input.width - x, overlay.frame.bbox.width));
      const h = Math.max(1, Math.min(input.height - y, overlay.frame.bbox.height));
      filters.push(`drawbox=x=${x.toFixed(2)}:y=${y.toFixed(2)}:w=${w.toFixed(2)}:h=${h.toFixed(2)}:color=0x${color}@0.95:t=2`);

      let labelText = `${overlay.label} #${overlay.trackId}`;
      if (input.showSpeed) {
        const speed = overlay.frame.velocity.km_per_h ?? overlay.frame.velocity.speed_px_per_s;
        const unit = overlay.frame.velocity.km_per_h == null ? "px/s" : "km/h";
        labelText += ` ${speed.toFixed(1)}${unit}`;
      }
      const safeText = escapeDrawText(labelText);
      const textY = Math.max(10, y - 8);
      filters.push(
        `drawtext=text='${safeText}':x=${Math.max(0, x).toFixed(2)}:y=${textY.toFixed(2)}:fontsize=16:fontcolor=white:box=1:boxcolor=0x${color}@0.85`,
      );

      if (input.trailsEnabled && input.trailFrames > 0) {
        const trackFrames = perTrackIndex.get(overlay.trackId);
        if (trackFrames) {
          const trailStart = Math.max(0, index - input.trailFrames);
          for (let trailFrameIndex = trailStart; trailFrameIndex < index; trailFrameIndex += 1) {
            const trailFrame = trackFrames.get(trailFrameIndex);
            if (!trailFrame) {
              continue;
            }
            const center = centerOf(trailFrame.bbox);
            filters.push(
              `drawbox=x=${Math.max(0, center.x - 1.5).toFixed(2)}:y=${Math.max(0, center.y - 1.5).toFixed(2)}:w=3:h=3:color=0x${color}@0.7:t=fill`,
            );
          }
        }
      }
    }

    const targetFrame = path.join(annotatedDir, frameFileName(index));
    await runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      sourceFrame,
      "-vf",
      filters.join(","),
      "-q:v",
      "2",
      targetFrame,
    ]);
  }
}

async function encodeVideoFromFrames(input: { framesDir: string; fpsWork: number; outputPath: string }) {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-framerate",
    String(input.fpsWork),
    "-i",
    path.join(input.framesDir, "frame-%06d.jpg"),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    input.outputPath,
  ]);
}

async function extractFramesFromVideo(input: { videoPath: string; framesDir: string }) {
  await fs.rm(input.framesDir, { recursive: true, force: true });
  await fs.mkdir(input.framesDir, { recursive: true });
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input.videoPath,
    "-q:v",
    "2",
    path.join(input.framesDir, "frame-%06d.jpg"),
  ]);
}

async function createWorkVideo(input: {
  sourceVideoPath: string;
  outputPath: string;
  trimStartS: number;
  trimDurationS: number;
  fpsWork: number;
}) {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    input.trimStartS.toFixed(3),
    "-t",
    input.trimDurationS.toFixed(3),
    "-i",
    input.sourceVideoPath,
    "-vf",
    `fps=${input.fpsWork}`,
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    input.outputPath,
  ]);
}

async function processVideoRun(input: {
  projectId: string;
  runId: string;
  artifactId: string;
  sourceVideoPath: string;
  sourceVideoFilename: string;
  sourceVideoSha256: string;
  config: ProcessingConfig;
}) {
  await patchMetadata(input.projectId, input.runId, {
    stage: "extracting_frames",
    stage_progress: 0,
  });

  const sourceProbe = await probeVideo(input.sourceVideoPath);
  const trimStart = clamp(input.config.trimStartS, 0, Math.max(0, sourceProbe.durationS));
  const requestedEnd = input.config.trimEndS > trimStart ? input.config.trimEndS : trimStart + DEFAULT_TRIM_SECONDS;
  const cappedEnd = Math.min(requestedEnd, trimStart + DEFAULT_TRIM_SECONDS);
  const trimEnd = clamp(
    cappedEnd,
    trimStart + 0.1,
    Math.max(trimStart + 0.1, sourceProbe.durationS || trimStart + DEFAULT_TRIM_SECONDS),
  );
  const trimDuration = Math.max(0.1, trimEnd - trimStart);

  const workVideoPath = runWorkVideoPath(input.projectId, input.runId);
  const framesDir = runFramesDir(input.projectId, input.runId);
  const annotatedFramesDir = runAnnotatedFramesDir(input.projectId, input.runId);
  const annotatedVideoPath = runAnnotatedVideoPath(input.projectId, input.runId);
  const thumbnailPath = runThumbnailPath(input.projectId, input.runId);

  await createWorkVideo({
    sourceVideoPath: input.sourceVideoPath,
    outputPath: workVideoPath,
    trimStartS: trimStart,
    trimDurationS: trimDuration,
    fpsWork: input.config.fpsWork,
  });
  await extractFramesFromVideo({ videoPath: workVideoPath, framesDir });

  const workProbe = await probeVideo(workVideoPath);
  const frameFiles = await listFrameFiles(framesDir);
  if (frameFiles.length === 0) {
    throw new Error("No frames were extracted from the video.");
  }

  const keyframeIndices: number[] = [];
  for (let index = 0; index < frameFiles.length; index += 1) {
    if (index % input.config.inferenceStrideFrames === 0 || index === frameFiles.length - 1) {
      keyframeIndices.push(index);
    }
  }

  await patchMetadata(input.projectId, input.runId, {
    stage: "detecting_keyframes",
    stage_progress: 0,
  });

  const detectionsByFrame = new Map<number, Detection[]>();
  const openaiModel = resolveOpenAIModel();
  const promptFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        model: openaiModel,
        targets: input.config.targets,
        maxDetections: input.config.maxDetectionsPerFrame,
      }),
    )
    .digest("hex");

  for (let index = 0; index < keyframeIndices.length; index += 1) {
    const frameIndex = keyframeIndices[index]!;
    const framePath = frameFiles[frameIndex]!;
    const detections = await detectObjectsOnFrame({
      framePath,
      targets: input.config.targets,
      reasoningEffort: input.config.reasoningEffort,
      confidenceThreshold: input.config.confidenceThreshold,
      maxDetectionsPerFrame: input.config.maxDetectionsPerFrame,
      width: workProbe.width,
      height: workProbe.height,
    });
    detectionsByFrame.set(frameIndex, detections);
    await patchMetadata(input.projectId, input.runId, {
      stage_progress: clamp((index + 1) / keyframeIndices.length, 0, 1),
    });
  }

  await patchMetadata(input.projectId, input.runId, {
    stage: "tracking",
    stage_progress: 0,
  });

  const tracked = buildTracks({
    detectionsByFrame,
    frameCount: frameFiles.length,
    fpsWork: input.config.fpsWork,
    inferenceStrideFrames: input.config.inferenceStrideFrames,
    iouThreshold: 0.3,
  });
  const withVelocity = attachVelocity({
    tracks: tracked.tracks,
    fpsWork: input.config.fpsWork,
    speedEnabled: input.config.speedEnabled,
    speedMode: input.config.speedMode,
    metersPerPixel: input.config.metersPerPixel,
    smoothingWindowFrames: 5,
  });

  await patchMetadata(input.projectId, input.runId, {
    stage_progress: 1,
  });

  await patchMetadata(input.projectId, input.runId, {
    stage: "rendering",
    stage_progress: 0,
  });

  await renderAnnotatedFrames({
    projectId: input.projectId,
    runId: input.runId,
    width: workProbe.width,
    height: workProbe.height,
    fpsWork: input.config.fpsWork,
    tracks: withVelocity,
    showSpeed: input.config.speedEnabled,
    trailsEnabled: input.config.trailsEnabled,
    trailFrames: input.config.trailFrames,
  });
  await encodeVideoFromFrames({
    framesDir: annotatedFramesDir,
    fpsWork: input.config.fpsWork,
    outputPath: annotatedVideoPath,
  });

  const firstAnnotatedFrame = path.join(annotatedFramesDir, frameFileName(0));
  await fs.copyFile(firstAnnotatedFrame, thumbnailPath);

  const labels = [...new Set(withVelocity.map((track) => track.label))].sort((a, b) => a.localeCompare(b));
  const classIdByLabel = new Map(labels.map((label, index) => [label, index + 1]));

  const tracksPayload = withVelocity.map((track) => {
    const first = track.frames[0];
    const last = track.frames[track.frames.length - 1];
    const confidenceValues = track.frames
      .map((frame) => frame.confidence)
      .filter((value): value is number => value != null);
    const avgConfidence =
      confidenceValues.length > 0
        ? confidenceValues.reduce((acc, value) => acc + value, 0) / confidenceValues.length
        : null;

    return videoRunTrackSchema.parse({
      track_id: track.trackId,
      class_id: classIdByLabel.get(track.label) ?? 1,
      label: track.label,
      source: "auto+track",
      summary: {
        first_frame: first?.frameIndex ?? 0,
        last_frame: last?.frameIndex ?? 0,
        num_frames: track.frames.length,
        avg_confidence: avgConfidence,
        id_switches: 0,
        missed_frames:
          first && last ? Math.max(0, last.frameIndex - first.frameIndex + 1 - track.frames.length) : 0,
      },
      frames: track.frames.map((frame) => ({
        frame_index: frame.frameIndex,
        t_s: frame.tS,
        bbox_xywh: [frame.bbox.x, frame.bbox.y, frame.bbox.width, frame.bbox.height],
        confidence: frame.confidence,
        is_keyframe_detection: frame.isKeyframeDetection,
        velocity: frame.velocity,
      })),
    });
  });

  const frameIndexPayload = new Map<number, Array<{ track_id: number; class_id: number; bbox_xywh: [number, number, number, number]; confidence: number | null }>>();
  for (const track of tracksPayload) {
    for (const frame of track.frames) {
      const list = frameIndexPayload.get(frame.frame_index) ?? [];
      list.push({
        track_id: track.track_id,
        class_id: track.class_id,
        bbox_xywh: frame.bbox_xywh,
        confidence: frame.confidence,
      });
      frameIndexPayload.set(frame.frame_index, list);
    }
  }

  const tracksFile = tracksFileSchema.parse({
    schema_version: "1.0",
    run_id: input.runId,
    video: {
      filename: input.sourceVideoFilename,
      sha256: input.sourceVideoSha256,
      width: workProbe.width,
      height: workProbe.height,
      fps_input: sourceProbe.fps,
      fps_work: input.config.fpsWork,
      duration_s: trimDuration,
      trim: {
        start_s: trimStart,
        end_s: trimEnd,
      },
    },
    classes: labels.map((label) => ({
      class_id: classIdByLabel.get(label) ?? 1,
      name: label,
    })),
    tracks: tracksPayload,
    frame_index: [...frameIndexPayload.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([frameIndex, detections]) => ({
        frame_index: frameIndex,
        t_s: frameIndex / input.config.fpsWork,
        detections,
      })),
  });

  await fs.writeFile(runTracksPath(input.projectId, input.runId), JSON.stringify(tracksFile, null, 2), "utf8");

  const project = await getProject(input.projectId);
  const projectName = project?.name ?? "Project";
  const metadata = runMetadataSchema.parse({
    schema_version: "1.0",
    run_id: input.runId,
    created_at: (await readMetadata(input.projectId, input.runId))?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "done",
    stage: "completed",
    stage_progress: 1,
    error: null,
    summary: {
      targets: input.config.targets,
      mode: input.config.mode,
      quality_mode: input.config.qualityMode,
      speed_mode: input.config.speedMode,
      duration_s: trimDuration,
      frame_count: frameFiles.length,
    },
    project: {
      project_id: input.projectId,
      project_name: projectName,
      project_path: projectDir(input.projectId),
    },
    input: {
      artifact_id: input.artifactId,
      video_path: input.sourceVideoPath,
      video_filename: input.sourceVideoFilename,
      video_sha256: input.sourceVideoSha256,
    },
    processing: {
      trim: { start_s: trimStart, end_s: trimEnd },
      fps_work: input.config.fpsWork,
      frame_count: frameFiles.length,
      inference_stride_frames: input.config.inferenceStrideFrames,
      confidence_threshold: input.config.confidenceThreshold,
      max_detections_per_frame: input.config.maxDetectionsPerFrame,
      targets: labels.map((label) => ({
        class_id: classIdByLabel.get(label) ?? 1,
        name: label,
      })),
      presets: {
        quality_mode: input.config.qualityMode,
      },
    },
    tracking: {
      tracker_name: "flowstate_iou_linear",
      params: {
        iou_match_threshold: 0.3,
        max_age_frames: tracked.maxAgeFrames,
        min_hits: 1,
      },
      smoothing: {
        enabled: true,
        method: "moving_average",
        window_frames: 5,
      },
    },
    speed: {
      enabled: input.config.speedEnabled,
      mode: input.config.speedMode,
      calibration: {
        enabled: input.config.speedMode === "calibrated",
        method:
          input.config.speedMode === "calibrated"
            ? input.config.calibrationReference
              ? "two_point_reference"
              : input.config.metersPerPixel
                ? "meters_per_pixel"
                : null
            : null,
        meters_per_pixel: input.config.speedMode === "calibrated" ? input.config.metersPerPixel : null,
        reference: input.config.calibrationReference
          ? {
              x1: input.config.calibrationReference.x1,
              y1: input.config.calibrationReference.y1,
              x2: input.config.calibrationReference.x2,
              y2: input.config.calibrationReference.y2,
              distance_m: input.config.calibrationReference.distanceM,
            }
          : null,
      },
    },
    openai: {
      enabled: true,
      purpose: "keyframe_detection",
      model: openaiModel,
      reasoning_effort: input.config.reasoningEffort,
      requests: {
        num_images_sent: keyframeIndices.length,
        estimated_total_tokens: null,
      },
      prompt_fingerprint: promptFingerprint,
    },
    outputs: {
      tracks_json_path: relFromDataDir(runTracksPath(input.projectId, input.runId)),
      run_metadata_path: relFromDataDir(runMetadataPath(input.projectId, input.runId)),
      annotated_video_path: relFromDataDir(annotatedVideoPath),
      work_video_path: relFromDataDir(workVideoPath),
      preview_thumbnail_path: relFromDataDir(thumbnailPath),
    },
    ops_history: [],
  });

  await writeMetadata(metadata);
}

async function failRun(projectId: string, runId: string, message: string) {
  const current = await readMetadata(projectId, runId);
  if (!current) {
    return;
  }
  await writeMetadata(
    runMetadataSchema.parse({
      ...current,
      status: "failed",
      stage: "failed",
      stage_progress: null,
      error: message,
      updated_at: new Date().toISOString(),
    }),
  );
}

export async function createVideoRun(input: CreateVideoRunInput) {
  const project = await getProject(input.projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const source = await resolveArtifactFilePath(input.artifactId);
  if (!source) {
    throw new Error("Video artifact not found");
  }
  if (!source.artifact.mime_type.startsWith("video/")) {
    throw new Error("Only video artifacts are supported.");
  }

  const config = resolveProcessingConfig(input);
  if (config.targets.length === 0) {
    throw new Error("Select at least one target class.");
  }

  const runId = await nextRunId(input.projectId);
  const directory = runDir(input.projectId, runId);
  await fs.mkdir(directory, { recursive: true });

  const sourceSha256 = await sha256OfFile(source.filePath);
  const initialMetadata = runMetadataSchema.parse({
    schema_version: "1.0",
    run_id: runId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "processing",
    stage: "queued",
    stage_progress: 0,
    error: null,
    summary: null,
    project: {
      project_id: input.projectId,
      project_name: project.name,
      project_path: projectDir(input.projectId),
    },
    input: {
      artifact_id: input.artifactId,
      video_path: source.filePath,
      video_filename: source.artifact.original_name,
      video_sha256: sourceSha256,
    },
    processing: {
      trim: { start_s: 0, end_s: DEFAULT_TRIM_SECONDS },
      fps_work: config.fpsWork,
      frame_count: 0,
      inference_stride_frames: config.inferenceStrideFrames,
      confidence_threshold: config.confidenceThreshold,
      max_detections_per_frame: config.maxDetectionsPerFrame,
      targets: [],
      presets: { quality_mode: config.qualityMode },
    },
    tracking: {
      tracker_name: "flowstate_iou_linear",
      params: {
        iou_match_threshold: 0.3,
        max_age_frames: Math.max(config.inferenceStrideFrames * 2, 2),
        min_hits: 1,
      },
      smoothing: {
        enabled: true,
        method: "moving_average",
        window_frames: 5,
      },
    },
    speed: {
      enabled: config.speedEnabled,
      mode: config.speedMode,
      calibration: {
        enabled: config.speedMode === "calibrated",
        method: null,
        meters_per_pixel: config.metersPerPixel,
        reference: config.calibrationReference
          ? {
              x1: config.calibrationReference.x1,
              y1: config.calibrationReference.y1,
              x2: config.calibrationReference.x2,
              y2: config.calibrationReference.y2,
              distance_m: config.calibrationReference.distanceM,
            }
          : null,
      },
    },
    openai: {
      enabled: true,
      purpose: "keyframe_detection",
      model: resolveOpenAIModel(),
      reasoning_effort: config.reasoningEffort,
      requests: {
        num_images_sent: 0,
        estimated_total_tokens: null,
      },
      prompt_fingerprint: "",
    },
    outputs: {
      tracks_json_path: relFromDataDir(runTracksPath(input.projectId, runId)),
      run_metadata_path: relFromDataDir(runMetadataPath(input.projectId, runId)),
      annotated_video_path: null,
      work_video_path: null,
      preview_thumbnail_path: null,
    },
    ops_history: [],
  });
  await writeMetadata(initialMetadata);

  void processVideoRun({
    projectId: input.projectId,
    runId,
    artifactId: input.artifactId,
    sourceVideoPath: source.filePath,
    sourceVideoFilename: source.artifact.original_name,
    sourceVideoSha256: sourceSha256,
    config,
  }).catch(async (error) => {
    const message = error instanceof Error ? error.message : "Video run failed";
    await failRun(input.projectId, runId, message);
  });

  return initialMetadata;
}

export async function listVideoRuns(projectId: string) {
  const dir = projectVideoRunsDir(projectId);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const records: VideoRunMetadata[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const metadata = await readMetadata(projectId, entry.name);
      if (metadata) {
        records.push(metadata);
      }
    }
    records.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
    return records;
  } catch {
    return [];
  }
}

export async function getVideoRun(projectId: string, runId: string) {
  return readMetadata(projectId, runId);
}

export async function getVideoRunTracks(projectId: string, runId: string) {
  try {
    const text = await fs.readFile(runTracksPath(projectId, runId), "utf8");
    return tracksFileSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function readVideoRunFile(input: {
  projectId: string;
  runId: string;
  kind: "annotated" | "work" | "thumbnail" | "tracks" | "metadata";
}) {
  const metadata = await getVideoRun(input.projectId, input.runId);
  if (!metadata) {
    return null;
  }

  let filePath: string;
  let contentType: string;
  let fileName: string;

  if (input.kind === "annotated") {
    filePath = runAnnotatedVideoPath(input.projectId, input.runId);
    contentType = "video/mp4";
    fileName = "annotated.mp4";
  } else if (input.kind === "work") {
    filePath = runWorkVideoPath(input.projectId, input.runId);
    contentType = "video/mp4";
    fileName = "work.mp4";
  } else if (input.kind === "thumbnail") {
    filePath = runThumbnailPath(input.projectId, input.runId);
    contentType = "image/jpeg";
    fileName = "thumb.jpg";
  } else if (input.kind === "tracks") {
    filePath = runTracksPath(input.projectId, input.runId);
    contentType = "application/json";
    fileName = "tracks.json";
  } else {
    filePath = runMetadataPath(input.projectId, input.runId);
    contentType = "application/json";
    fileName = "run_metadata.json";
  }

  try {
    const bytes = await fs.readFile(filePath);
    return { metadata, bytes, contentType, fileName, filePath };
  } catch {
    return null;
  }
}

export const __private = {
  normalizeTargets,
  resolveProcessingConfig,
  iou,
  movingAverage,
  buildTracks,
  attachVelocity,
  parseFraction,
};
