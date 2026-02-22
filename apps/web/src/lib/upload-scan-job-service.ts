import {
  createDatasetBatch,
  createUploadScanJob,
  getUploadScanJob,
  ingestDatasetBatch,
  listDatasetAssetsByBatch,
  listLatestAssetAnnotations,
  patchUploadScanJob,
} from "@/lib/data-store-v2";
import { runAssetAutoLabel } from "@/lib/auto-label-service";

const activeJobs = new Set<string>();

function isRenderableAssetType(assetType: "image" | "video_frame" | "pdf_page") {
  return assetType === "image" || assetType === "video_frame";
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

    let labeledCount = 0;
    let failedCount = 0;
    for (const [index, asset] of runnableAssets.entries()) {
      const progress = 0.45 + ((index + 1) / Math.max(1, runnableAssets.length)) * 0.45;
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
        const reason = error instanceof Error ? error.message : "unknown error";
        await patchUploadScanJob({
          jobId,
          progress,
          message: `Auto-labeling (${index + 1}/${runnableAssets.length})`,
          appendLog: `asset ${asset.id} failed: ${reason}`,
        });
        continue;
      }

      await patchUploadScanJob({
        jobId,
        progress,
        message: `Auto-labeling (${index + 1}/${runnableAssets.length})`,
      });
    }

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

    await patchUploadScanJob({
      jobId,
      status: "completed",
      stage: "completed",
      progress: 1,
      message: `Completed. Labeled ${labeledCount}/${runnableAssets.length} assets.`,
      previewAssetId: previewAsset?.id ?? null,
      labeledAssetsCount: labeledCount,
      failedAssetsCount: failedCount + ingest.failed_extraction_artifact_ids.length,
      appendLog: "completed",
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
