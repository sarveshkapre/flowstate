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
const MAX_AUTO_LABEL_CONCURRENCY = 50;
const MIN_ADAPTIVE_CONCURRENCY = 8;
const MAX_AUTO_LABEL_ATTEMPTS = 3;
let ffmpegDrawTextSupportPromise: Promise<boolean> | null = null;

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

async function ffmpegSupportsDrawText() {
  if (ffmpegDrawTextSupportPromise) {
    return ffmpegDrawTextSupportPromise;
  }

  ffmpegDrawTextSupportPromise = runCommand("ffmpeg", ["-hide_banner", "-filters"])
    .then(({ stdout, stderr }) => {
      const combined = `${stdout}\n${stderr}`.toLowerCase();
      return combined.includes(" drawtext");
    })
    .catch(() => false);

  return ffmpegDrawTextSupportPromise;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return String(error ?? "unknown error");
}

function isRetryableAutoLabelError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many request") ||
    message.includes("overloaded") ||
    message.includes("timeout") ||
    message.includes("temporar") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatDurationSeconds(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

function formatDurationMs(ms: number) {
  return formatDurationSeconds(ms / 1000);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function estimateEtaLabel(completed: number, total: number, startedAtMs: number) {
  if (completed <= 0 || total <= completed) {
    return "estimating";
  }
  const elapsedSeconds = Math.max(1, (Date.now() - startedAtMs) / 1000);
  const throughput = completed / elapsedSeconds;
  if (!Number.isFinite(throughput) || throughput <= 0) {
    return "estimating";
  }
  const remainingSeconds = (total - completed) / throughput;
  return formatDurationSeconds(remainingSeconds);
}

async function runAutoLabelWithRetry(input: {
  assetId: string;
  prompt?: string;
  reasoningEffort: "low" | "medium" | "high";
  maxObjects?: number;
  qualityMode: "fast" | "dense";
  actor?: string;
}) {
  let attempt = 0;
  let retryableSignals = 0;
  let totalBackoffMs = 0;

  while (attempt < MAX_AUTO_LABEL_ATTEMPTS) {
    attempt += 1;
    try {
      await runAssetAutoLabel(input.assetId, {
        prompt: input.prompt,
        reasoningEffort: input.reasoningEffort,
        maxObjects: input.maxObjects,
        qualityMode: input.qualityMode,
        actor: input.actor,
      });
      return {
        ok: true as const,
        attempts: attempt,
        retries: Math.max(0, attempt - 1),
        retryableSignals,
        totalBackoffMs,
        reason: null,
        retryable: false,
      };
    } catch (error) {
      const reason = errorMessage(error);
      const retryable = isRetryableAutoLabelError(error);
      if (!retryable || attempt >= MAX_AUTO_LABEL_ATTEMPTS) {
        return {
          ok: false as const,
          attempts: attempt,
          retries: Math.max(0, attempt - 1),
          retryableSignals,
          totalBackoffMs,
          reason,
          retryable,
        };
      }

      retryableSignals += 1;
      const backoffMs = Math.min(4000, 350 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
      totalBackoffMs += backoffMs;
      await sleep(backoffMs);
    }
  }

  return {
    ok: false as const,
    attempts: MAX_AUTO_LABEL_ATTEMPTS,
    retries: Math.max(0, MAX_AUTO_LABEL_ATTEMPTS - 1),
    retryableSignals,
    totalBackoffMs,
    reason: "Unknown retry state",
    retryable: false,
  };
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

function shapeOverlayLabel(shape: AssetAnnotationRecord["shapes"][number]) {
  const base = shape.label.trim() || "object";
  const identity = shape.identity;
  if (!identity?.possible_name) {
    return base;
  }
  const confidence = identity.confidence ?? 0;
  if (confidence < 0.62) {
    return base;
  }
  return `${base}: ${identity.possible_name}`;
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

    const drawTextSupported = await ffmpegSupportsDrawText();
    const renderStartedAt = Date.now();
    const overlayStartedAt = renderStartedAt;
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

        if (drawTextSupported) {
          const label = shapeOverlayLabel(shape);
          const safeText = escapeDrawText(label);
          const textY = Math.max(10, y - 8);
          filters.push(
            `drawtext=text='${safeText}':x=${Math.max(0, x).toFixed(2)}:y=${textY.toFixed(2)}:fontsize=16:fontcolor=white:box=1:boxcolor=0x${color}@0.85`,
          );
        }
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
    const overlayDurationMs = Date.now() - overlayStartedAt;

    const fps = estimatedFpsFromFrames(availableAssets.map((item) => item.asset));
    const encodeStartedAt = Date.now();
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
    const encodeDurationMs = Date.now() - encodeStartedAt;
    const renderDurationMs = Date.now() - renderStartedAt;

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

    return {
      artifactId: artifact.id,
      frameCount: availableAssets.length,
      fps,
      sizeBytes: videoBytes.byteLength,
      overlayDurationMs,
      encodeDurationMs,
      renderDurationMs,
      drawTextSupported,
    };
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

    const jobStartedAt = Date.now();
    await patchUploadScanJob({
      jobId,
      status: "processing",
      stage: "creating_batch",
      progress: 0.1,
      message: "Creating dataset batch",
      errorMessage: null,
      appendLog: "creating batch",
    });

    const createBatchStartedAt = Date.now();
    const batch = await createDatasetBatch({
      datasetId: job.dataset_id,
      name: job.batch_name,
      sourceType: job.source_type,
      sourceArtifactIds: job.source_artifact_ids,
      actor: job.created_by ?? undefined,
    });
    const createBatchDurationMs = Date.now() - createBatchStartedAt;

    await patchUploadScanJob({
      jobId,
      batchId: batch.id,
      stage: "ingesting_batch",
      progress: 0.25,
      message: "Ingesting uploaded files",
      appendLog: `batch ${batch.id} created in ${formatDurationMs(createBatchDurationMs)}; ingesting`,
    });

    const ingestStartedAt = Date.now();
    const ingest = await ingestDatasetBatch({
      batchId: batch.id,
      maxVideoFrames: job.max_video_frames ?? undefined,
      actor: job.created_by ?? undefined,
    });
    const ingestDurationMs = Date.now() - ingestStartedAt;

    await patchUploadScanJob({
      jobId,
      createdAssetsCount: ingest.created_assets_count,
      stage: "auto_labeling",
      progress: 0.45,
      message: `Auto-labeling ${ingest.created_assets_count} asset(s)`,
      appendLog: `ingested ${ingest.created_assets_count} asset(s) in ${formatDurationMs(ingestDurationMs)}`,
    });

    const batchAssets = await listDatasetAssetsByBatch({
      batchId: batch.id,
      status: "ready",
      limit: 500,
    });
    const runnableAssets = batchAssets.filter((asset) => isRenderableAssetType(asset.asset_type));

    if (runnableAssets.length === 0) {
      const totalDurationMs = Date.now() - jobStartedAt;
      await patchUploadScanJob({
        jobId,
        status: "completed",
        stage: "completed",
        progress: 1,
        message: "No image assets found in batch.",
        failedAssetsCount: ingest.failed_extraction_artifact_ids.length,
        appendLog: `completed with no runnable assets (total=${formatDurationMs(totalDurationMs)})`,
      });
      return;
    }

    const targetConcurrency = Math.min(MAX_AUTO_LABEL_CONCURRENCY, Math.max(1, runnableAssets.length));
    const adaptiveFloor = Math.min(MIN_ADAPTIVE_CONCURRENCY, targetConcurrency);
    let currentConcurrency = targetConcurrency;
    await patchUploadScanJob({
      jobId,
      appendLog: `video_preset=${job.video_analysis_preset}, max_video_frames=${job.max_video_frames ?? "default"}, target_concurrency=${targetConcurrency}`,
    });

    let labeledCount = 0;
    let failedCount = 0;
    let completedCount = 0;
    let nextOffset = 0;
    let waveIndex = 0;
    const labelingStartedAt = Date.now();
    while (nextOffset < runnableAssets.length) {
      waveIndex += 1;
      const waveAssets = runnableAssets.slice(nextOffset, nextOffset + currentConcurrency);
      nextOffset += waveAssets.length;
      const waveStartedAt = Date.now();
      await patchUploadScanJob({
        jobId,
        appendLog: `wave ${waveIndex} start: assets=${waveAssets.length}, concurrency=${currentConcurrency}`,
      });

      const results = await Promise.all(
        waveAssets.map(async (asset) => {
          const result = await runAutoLabelWithRetry({
            assetId: asset.id,
            prompt: job.scan_prompt ?? undefined,
            reasoningEffort: job.reasoning_effort,
            maxObjects: job.max_objects ?? undefined,
            qualityMode: job.quality_mode,
            actor: job.created_by ?? undefined,
          });
          return { asset, result };
        }),
      );

      let waveRetryableSignals = 0;
      let waveRetryableFinalFailures = 0;
      let waveRetries = 0;
      let waveBackoffMs = 0;
      let waveFailedCount = 0;

      for (const item of results) {
        completedCount += 1;
        waveRetryableSignals += item.result.retryableSignals;
        waveRetries += item.result.retries;
        waveBackoffMs += item.result.totalBackoffMs;

        if (item.result.ok) {
          labeledCount += 1;
        } else {
          failedCount += 1;
          waveFailedCount += 1;
          if (item.result.retryable) {
            waveRetryableFinalFailures += 1;
          }
        }

        const progress = 0.45 + (completedCount / Math.max(1, runnableAssets.length)) * 0.45;
        const eta = estimateEtaLabel(completedCount, runnableAssets.length, labelingStartedAt);
        await patchUploadScanJob({
          jobId,
          progress,
          message: `Auto-labeling (${completedCount}/${runnableAssets.length}) • ETA ${eta}`,
          appendLog: !item.result.ok
            ? `asset ${item.asset.id} failed after ${item.result.attempts} attempt(s), retries=${item.result.retries}, backoff=${formatDurationMs(item.result.totalBackoffMs)}: ${item.result.reason}`
            : item.result.retries > 0
              ? `asset ${item.asset.id} succeeded after retry: attempts=${item.result.attempts}, backoff=${formatDurationMs(item.result.totalBackoffMs)}`
              : undefined,
        });
      }

      const waveDurationMs = Date.now() - waveStartedAt;
      await patchUploadScanJob({
        jobId,
        appendLog: `wave ${waveIndex} done: ok=${results.length - waveFailedCount}, failed=${waveFailedCount}, retries=${waveRetries}, backoff=${formatDurationMs(waveBackoffMs)}, duration=${formatDurationMs(waveDurationMs)}`,
      });

      if (
        currentConcurrency > adaptiveFloor &&
        (waveRetryableSignals >= Math.max(3, Math.floor(results.length / 2)) ||
          waveRetryableFinalFailures >= 1)
      ) {
        const nextConcurrency = Math.max(adaptiveFloor, Math.floor(currentConcurrency * 0.7));
        if (nextConcurrency < currentConcurrency) {
          currentConcurrency = nextConcurrency;
          await patchUploadScanJob({
            jobId,
            appendLog: `adaptive throttle: reduced concurrency to ${currentConcurrency} (retry_signals=${waveRetryableSignals}, retryable_failures=${waveRetryableFinalFailures})`,
          });
        }
      }
    }
    const labelingDurationMs = Date.now() - labelingStartedAt;

    const finalizingStartedAt = Date.now();
    const latestMap = await listLatestAssetAnnotations(runnableAssets.map((asset) => asset.id));
    const previewAsset =
      runnableAssets.find((asset) => latestMap.has(asset.id)) ?? runnableAssets[0] ?? null;
    const videoFrameAssets = runnableAssets.filter(
      (asset) => asset.asset_type === "video_frame" && Boolean(asset.artifact_id),
    );
    const failedAssetsCount = failedCount + ingest.failed_extraction_artifact_ids.length;
    const finalizingEta = formatDurationSeconds(videoFrameAssets.length > 0 ? Math.max(8, Math.ceil(videoFrameAssets.length / 5)) : 5);

    await patchUploadScanJob({
      jobId,
      stage: "finalizing",
      progress: 0.95,
      message: `Finalizing outputs • ETA ${finalizingEta}`,
      labeledAssetsCount: labeledCount,
      failedAssetsCount,
      appendLog: `labeled=${labeledCount}, failed=${failedCount}, labeling_duration=${formatDurationMs(labelingDurationMs)}`,
    });

    let annotatedVideoArtifactId: string | null = null;
    let annotatedVideoStats: Awaited<ReturnType<typeof createAnnotatedVideoArtifactFromFrames>> | null = null;
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
        const renderEta = formatDurationSeconds(Math.max(8, Math.ceil(primaryVideoFrames.length / 5)));
        await patchUploadScanJob({
          jobId,
          progress: 0.97,
          message: `Rendering annotated clip (${primaryVideoFrames.length} frames) • ETA ${renderEta}`,
        });
        try {
          const videoResult = await createAnnotatedVideoArtifactFromFrames({
            batchName: job.batch_name,
            assets: primaryVideoFrames,
            latestByAssetId: latestMap,
          });
          if (videoResult) {
            annotatedVideoArtifactId = videoResult.artifactId;
            annotatedVideoStats = videoResult;
            await patchUploadScanJob({
              jobId,
              appendLog: `annotated video ready: frames=${videoResult.frameCount}, fps=${videoResult.fps.toFixed(2)}, labels=${videoResult.drawTextSupported ? "on" : "off (ffmpeg missing drawtext)"}, size=${formatBytes(videoResult.sizeBytes)}, overlay=${formatDurationMs(videoResult.overlayDurationMs)}, encode=${formatDurationMs(videoResult.encodeDurationMs)}, render=${formatDurationMs(videoResult.renderDurationMs)}`,
            });
          } else {
            await patchUploadScanJob({
              jobId,
              appendLog: "annotated video output skipped: no usable frames",
            });
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : "unknown error";
          await patchUploadScanJob({
            jobId,
            appendLog: `annotated video output failed: ${reason}`,
          });
        }
      }
    }

    const finalizingDurationMs = Date.now() - finalizingStartedAt;
    const totalDurationMs = Date.now() - jobStartedAt;
    const timingSummary =
      `timings create_batch=${formatDurationMs(createBatchDurationMs)}, ` +
      `ingest=${formatDurationMs(ingestDurationMs)}, labeling=${formatDurationMs(labelingDurationMs)}, ` +
      `finalizing=${formatDurationMs(finalizingDurationMs)}, total=${formatDurationMs(totalDurationMs)}`;
    const completionLog = annotatedVideoStats
      ? `${timingSummary}; completed with annotated video output (${formatBytes(annotatedVideoStats.sizeBytes)})`
      : `${timingSummary}; completed`;

    await patchUploadScanJob({
      jobId,
      status: "completed",
      stage: "completed",
      progress: 1,
      message: `Completed. Labeled ${labeledCount}/${runnableAssets.length} assets in ${formatDurationMs(totalDurationMs)}.`,
      previewAssetId: previewAsset?.id ?? null,
      annotatedVideoArtifactId,
      labeledAssetsCount: labeledCount,
      failedAssetsCount,
      appendLog: completionLog,
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
