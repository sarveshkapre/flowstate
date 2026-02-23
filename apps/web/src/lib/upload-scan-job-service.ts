import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { AssetAnnotationRecord, DatasetAssetRecord } from "@flowstate/types";

import { createArtifact } from "@/lib/data-store";
import {
  createDatasetBatch,
  createUploadScanJob,
  getUploadScanJob,
  ingestDatasetBatch,
  listDatasetAssetsByBatch,
  listLatestAssetAnnotations,
  patchUploadScanJob,
  resolveDatasetAssetBinarySource,
} from "@/lib/data-store-v2";
import { inferImageDimensionsFromBuffer } from "@/lib/image-dimensions";
import { runAssetAutoLabel } from "@/lib/auto-label-service";

const execFile = promisify(execFileCallback);
const COMMAND_BUFFER_SIZE = 16 * 1024 * 1024;
const activeJobs = new Set<string>();
const OVERLAY_COLORS = ["00ff88", "00d2ff", "ffc400", "ff6b6b", "8f7bff", "6ee7b7", "f97316"];

function isRenderableAssetType(assetType: "image" | "video_frame" | "pdf_page") {
  return assetType === "image" || assetType === "video_frame";
}

function frameFileName(index: number) {
  return `frame-${String(index + 1).padStart(6, "0")}.jpg`;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

async function runCommand(command: string, args: string[]) {
  return execFile(command, args, {
    encoding: "utf8",
    maxBuffer: COMMAND_BUFFER_SIZE,
  });
}

function escapeDrawText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,");
}

function colorForLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  const hash = createHash("md5").update(normalized || "object").digest();
  return OVERLAY_COLORS[hash[0]! % OVERLAY_COLORS.length]!;
}

async function resolveAssetDimensions(asset: DatasetAssetRecord, filePath: string) {
  if (asset.width && asset.width > 0 && asset.height && asset.height > 0) {
    return { width: asset.width, height: asset.height };
  }

  try {
    const bytes = await fs.readFile(filePath);
    const inferred = inferImageDimensionsFromBuffer(bytes);
    if (inferred?.width && inferred?.height) {
      return inferred;
    }
  } catch {
    return null;
  }

  return null;
}

function estimatedFpsFromFrames(assets: DatasetAssetRecord[]) {
  const timestamps = assets
    .map((asset) => asset.timestamp_ms)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);

  if (timestamps.length < 2) {
    return 3;
  }

  const diffs: number[] = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const diff = timestamps[index]! - timestamps[index - 1]!;
    if (diff > 0) {
      diffs.push(diff);
    }
  }

  if (diffs.length === 0) {
    return 3;
  }

  diffs.sort((left, right) => left - right);
  const median = diffs[Math.floor(diffs.length / 2)]!;
  const fps = 1000 / median;
  if (!Number.isFinite(fps) || fps <= 0) {
    return 3;
  }

  return clamp(fps, 0.5, 30);
}

async function createAnnotatedVideoArtifactFromFrames(input: {
  batchName: string;
  assets: DatasetAssetRecord[];
  latestByAssetId: Map<string, AssetAnnotationRecord>;
}) {
  const orderedAssets = [...input.assets].sort(
    (left, right) => (left.frame_index ?? Number.MAX_SAFE_INTEGER) - (right.frame_index ?? Number.MAX_SAFE_INTEGER),
  );
  if (orderedAssets.length === 0) {
    return null;
  }

  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "flowstate-upload-video-"));
  const annotatedFramesDir = path.join(tempRoot, "annotated-frames");
  const outputVideoPath = path.join(tempRoot, "annotated.mp4");

  try {
    await fs.mkdir(annotatedFramesDir, { recursive: true });

    const availableAssets: Array<{
      asset: DatasetAssetRecord;
      sourcePath: string;
      width: number;
      height: number;
    }> = [];
    for (const asset of orderedAssets) {
      const source = await resolveDatasetAssetBinarySource(asset);
      if (!source) {
        continue;
      }
      const dimensions = await resolveAssetDimensions(asset, source.filePath);
      if (!dimensions) {
        continue;
      }
      availableAssets.push({
        asset,
        sourcePath: source.filePath,
        width: dimensions.width,
        height: dimensions.height,
      });
    }

    if (availableAssets.length === 0) {
      return null;
    }

    for (const [index, frame] of availableAssets.entries()) {
      const outputFramePath = path.join(annotatedFramesDir, frameFileName(index));
      const latest = input.latestByAssetId.get(frame.asset.id);
      const shapes = latest?.shapes ?? [];
      if (shapes.length === 0) {
        await fs.copyFile(frame.sourcePath, outputFramePath);
        continue;
      }

      const filters: string[] = [];
      for (const shape of shapes) {
        if (shape.geometry.type !== "bbox") {
          continue;
        }

        const x = clamp(shape.geometry.x, 0, 1) * frame.width;
        const y = clamp(shape.geometry.y, 0, 1) * frame.height;
        const w = clamp(shape.geometry.width, 0, 1) * frame.width;
        const h = clamp(shape.geometry.height, 0, 1) * frame.height;
        if (w < 1 || h < 1) {
          continue;
        }

        const color = colorForLabel(shape.label);
        filters.push(
          `drawbox=x=${x.toFixed(2)}:y=${y.toFixed(2)}:w=${w.toFixed(2)}:h=${h.toFixed(2)}:color=0x${color}@0.95:t=2`,
        );

        const label = shape.label.trim() || "object";
        const safeText = escapeDrawText(label);
        const textY = Math.max(10, y - 8);
        filters.push(
          `drawtext=text='${safeText}':x=${Math.max(0, x).toFixed(2)}:y=${textY.toFixed(2)}:fontsize=16:fontcolor=white:box=1:boxcolor=0x${color}@0.85`,
        );
      }

      if (filters.length === 0) {
        await fs.copyFile(frame.sourcePath, outputFramePath);
        continue;
      }

      await runCommand("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        frame.sourcePath,
        "-vf",
        filters.join(","),
        "-q:v",
        "2",
        outputFramePath,
      ]);
    }

    const fps = estimatedFpsFromFrames(availableAssets.map((item) => item.asset));
    await runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-framerate",
      fps.toFixed(6),
      "-i",
      path.join(annotatedFramesDir, "frame-%06d.jpg"),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      outputVideoPath,
    ]);

    const videoBytes = await fs.readFile(outputVideoPath);
    const safeBase = input.batchName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);

    const artifact = await createArtifact({
      originalName: `${safeBase || "upload"}-annotated.mp4`,
      mimeType: "video/mp4",
      sizeBytes: videoBytes.byteLength,
      bytes: videoBytes,
    });

    return artifact.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create annotated video output.";
    throw new Error(message);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function enqueueUploadScanJob(input: {
  projectId: string;
  datasetId: string;
  batchName: string;
  sourceType: "image" | "video" | "mixed";
  sourceArtifactIds: string[];
  reasoningEffort: "low" | "medium" | "high";
  scanPrompt?: string | null;
  qualityMode: "fast" | "dense";
  maxObjects?: number | null;
  videoAnalysisPreset?: "minimum" | "balanced" | "high_quality";
  maxVideoFrames?: number | null;
  actor?: string;
}) {
  const job = await createUploadScanJob({
    projectId: input.projectId,
    datasetId: input.datasetId,
    batchName: input.batchName,
    sourceType: input.sourceType,
    sourceArtifactIds: input.sourceArtifactIds,
    reasoningEffort: input.reasoningEffort,
    scanPrompt: input.scanPrompt,
    qualityMode: input.qualityMode,
    maxObjects: input.maxObjects,
    videoAnalysisPreset: input.videoAnalysisPreset,
    maxVideoFrames: input.maxVideoFrames,
    actor: input.actor,
  });

  void processUploadScanJob(job.id);
  return job;
}

export async function processUploadScanJob(jobId: string) {
  if (activeJobs.has(jobId)) {
    return;
  }
  activeJobs.add(jobId);

  try {
    const job = await getUploadScanJob(jobId);
    if (!job) {
      return;
    }
    if (job.status === "completed" || job.status === "failed") {
      return;
    }

    await patchUploadScanJob({
      jobId,
      status: "processing",
      stage: "creating_batch",
      progress: 0.1,
      message: "Creating dataset batch",
      errorMessage: null,
      appendLog: "creating batch",
    });

    const batch = await createDatasetBatch({
      datasetId: job.dataset_id,
      name: job.batch_name,
      sourceType: job.source_type,
      sourceArtifactIds: job.source_artifact_ids,
      actor: job.created_by ?? undefined,
    });

    await patchUploadScanJob({
      jobId,
      batchId: batch.id,
      stage: "ingesting_batch",
      progress: 0.25,
      message: "Ingesting uploaded files",
      appendLog: `ingesting batch ${batch.id}`,
    });

    const ingest = await ingestDatasetBatch({
      batchId: batch.id,
      maxVideoFrames: job.max_video_frames ?? undefined,
      actor: job.created_by ?? undefined,
    });

    await patchUploadScanJob({
      jobId,
      createdAssetsCount: ingest.created_assets_count,
      stage: "auto_labeling",
      progress: 0.45,
      message: `Auto-labeling ${ingest.created_assets_count} asset(s)`,
      appendLog: `ingested ${ingest.created_assets_count} asset(s)`,
    });

    const batchAssets = await listDatasetAssetsByBatch({
      batchId: batch.id,
      status: "ready",
      limit: 500,
    });
    const runnableAssets = batchAssets.filter((asset) => isRenderableAssetType(asset.asset_type));

    if (runnableAssets.length === 0) {
      await patchUploadScanJob({
        jobId,
        status: "completed",
        stage: "completed",
        progress: 1,
        message: "No image assets found in batch.",
        failedAssetsCount: ingest.failed_extraction_artifact_ids.length,
        appendLog: "completed with no runnable assets",
      });
      return;
    }

    const inferredConcurrency =
      job.video_analysis_preset === "minimum"
        ? 4
        : job.video_analysis_preset === "high_quality"
          ? 2
          : 3;
    const maxConcurrency = Math.min(inferredConcurrency, 6, Math.max(1, runnableAssets.length));
    await patchUploadScanJob({
      jobId,
      appendLog: `video_preset=${job.video_analysis_preset}, max_video_frames=${job.max_video_frames ?? "default"}, label_concurrency=${maxConcurrency}`,
    });

    let labeledCount = 0;
    let failedCount = 0;
    let completedCount = 0;
    let nextIndex = 0;

    const runWorker = async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= runnableAssets.length) {
          return;
        }

        const asset = runnableAssets[index]!;
        let failureReason: string | null = null;
        try {
          await runAssetAutoLabel(asset.id, {
            prompt: job.scan_prompt ?? undefined,
            reasoningEffort: job.reasoning_effort,
            maxObjects: job.max_objects ?? undefined,
            qualityMode: job.quality_mode,
            actor: job.created_by ?? undefined,
          });
          labeledCount += 1;
        } catch (error) {
          failedCount += 1;
          failureReason = error instanceof Error ? error.message : "unknown error";
        }

        completedCount += 1;
        const progress = 0.45 + (completedCount / Math.max(1, runnableAssets.length)) * 0.45;
        await patchUploadScanJob({
          jobId,
          progress,
          message: `Auto-labeling (${completedCount}/${runnableAssets.length})`,
          appendLog: failureReason ? `asset ${asset.id} failed: ${failureReason}` : undefined,
        });
      }
    };

    await Promise.all(Array.from({ length: maxConcurrency }, () => runWorker()));

    await patchUploadScanJob({
      jobId,
      stage: "finalizing",
      progress: 0.95,
      message: "Finalizing outputs",
      labeledAssetsCount: labeledCount,
      failedAssetsCount: failedCount + ingest.failed_extraction_artifact_ids.length,
      appendLog: `labeled=${labeledCount}, failed=${failedCount}`,
    });

    const latestMap = await listLatestAssetAnnotations(runnableAssets.map((asset) => asset.id));
    const previewAsset =
      runnableAssets.find((asset) => latestMap.has(asset.id)) ?? runnableAssets[0] ?? null;
    const videoFrameAssets = runnableAssets.filter(
      (asset) => asset.asset_type === "video_frame" && Boolean(asset.artifact_id),
    );

    let annotatedVideoArtifactId: string | null = null;
    if (videoFrameAssets.length > 0) {
      const byArtifact = new Map<string, DatasetAssetRecord[]>();
      for (const asset of videoFrameAssets) {
        if (!asset.artifact_id) {
          continue;
        }
        const list = byArtifact.get(asset.artifact_id) ?? [];
        list.push(asset);
        byArtifact.set(asset.artifact_id, list);
      }

      const primaryVideoFrames =
        [...byArtifact.values()].sort((left, right) => right.length - left.length)[0] ?? [];
      if (primaryVideoFrames.length > 0) {
        try {
          annotatedVideoArtifactId = await createAnnotatedVideoArtifactFromFrames({
            batchName: job.batch_name,
            assets: primaryVideoFrames,
            latestByAssetId: latestMap,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : "unknown error";
          await patchUploadScanJob({
            jobId,
            appendLog: `annotated video output failed: ${reason}`,
          });
        }
      }
    }

    await patchUploadScanJob({
      jobId,
      status: "completed",
      stage: "completed",
      progress: 1,
      message: `Completed. Labeled ${labeledCount}/${runnableAssets.length} assets.`,
      previewAssetId: previewAsset?.id ?? null,
      annotatedVideoArtifactId,
      labeledAssetsCount: labeledCount,
      failedAssetsCount: failedCount + ingest.failed_extraction_artifact_ids.length,
      appendLog: annotatedVideoArtifactId ? "completed with annotated video output" : "completed",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload scan job failed";
    await patchUploadScanJob({
      jobId,
      status: "failed",
      stage: "failed",
      progress: null,
      message: "Job failed",
      errorMessage: message,
      appendLog: `failed: ${message}`,
    });
  } finally {
    activeJobs.delete(jobId);
  }
}
