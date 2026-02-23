"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, FolderOpen, Loader2, Upload } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent } from "@shadcn-ui/card";
import { Input } from "@shadcn-ui/input";
import { NativeSelect } from "@shadcn-ui/native-select";

type Project = {
  id: string;
  name: string;
};

type Dataset = {
  id: string;
  project_id: string;
  name: string;
};

type UploadArtifactResponse = {
  artifact: {
    id: string;
    mime_type: string;
  };
};

type BatchAsset = {
  id: string;
  asset_type: "image" | "video_frame" | "pdf_page";
  width: number | null;
  height: number | null;
  frame_index: number | null;
  page_number: number | null;
  latest_annotation?:
    | {
        id: string;
        shapes: Array<{
          id: string;
          label: string;
          confidence: number | null;
          geometry: {
            type: "bbox";
            x: number;
            y: number;
            width: number;
            height: number;
          };
        }>;
      }
    | null;
};

type ReasoningEffort = "low" | "medium" | "high";
type UploadScanJobStatus = "queued" | "processing" | "completed" | "failed";
type UploadScanJobStage =
  | "queued"
  | "creating_batch"
  | "ingesting_batch"
  | "auto_labeling"
  | "finalizing"
  | "completed"
  | "failed";
type UploadScanJob = {
  id: string;
  project_id: string;
  dataset_id: string;
  batch_name: string;
  source_type: "image" | "video" | "mixed";
  source_artifact_ids: string[];
  reasoning_effort: ReasoningEffort;
  scan_prompt: string | null;
  quality_mode: "fast" | "dense";
  max_objects: number | null;
  status: UploadScanJobStatus;
  stage: UploadScanJobStage;
  progress: number | null;
  message: string | null;
  error_message: string | null;
  batch_id: string | null;
  preview_asset_id: string | null;
  created_assets_count: number;
  labeled_assets_count: number;
  failed_assets_count: number;
  logs: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const IMAGE_FILE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_FILE_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"]);

function defaultBatchName() {
  return `Uploaded on ${new Date().toLocaleString()}`;
}

function fileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) {
    return "";
  }
  return fileName.slice(dotIndex).toLowerCase();
}

function detectUploadFileKind(file: File): "image" | "video" | null {
  if (file.type.startsWith("image/")) {
    return "image";
  }
  if (file.type.startsWith("video/")) {
    return "video";
  }

  const extension = fileExtension(file.name);
  if (IMAGE_FILE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (VIDEO_FILE_EXTENSIONS.has(extension)) {
    return "video";
  }

  return null;
}

function isSupportedUploadFile(file: File) {
  return detectUploadFileKind(file) !== null;
}

function inferSourceType(files: File[]): "image" | "video" | "mixed" {
  const found = new Set<"image" | "video">();
  for (const file of files) {
    const kind = detectUploadFileKind(file);
    if (kind === "image") {
      found.add("image");
      continue;
    }

    if (kind === "video") {
      found.add("video");
      continue;
    }
  }

  if (found.size !== 1) {
    return "mixed";
  }

  const first = found.values().next().value;
  return first ?? "mixed";
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function isJobRunning(status: UploadScanJobStatus) {
  return status === "queued" || status === "processing";
}

function stageLabel(stage: UploadScanJobStage) {
  switch (stage) {
    case "creating_batch":
      return "Creating batch";
    case "ingesting_batch":
      return "Ingesting files";
    case "auto_labeling":
      return "Auto-labeling";
    case "finalizing":
      return "Finalizing";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "Queued";
  }
}

export function UploadWorkspaceClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [batchName, setBatchName] = useState(defaultBatchName);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [scanPrompt, setScanPrompt] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewAsset, setPreviewAsset] = useState<BatchAsset | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<UploadScanJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [showCocoJson, setShowCocoJson] = useState(false);
  const [cocoPreviewText, setCocoPreviewText] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute("webkitdirectory", "");
      folderInputRef.current.setAttribute("directory", "");
    }
  }, []);

  async function ensureDataset(currentProjectId: string) {
    const listResponse = await fetch(
      `/api/v2/datasets?projectId=${encodeURIComponent(currentProjectId)}`,
      {
        cache: "no-store",
      },
    );
    const listPayload = (await listResponse.json().catch(() => ({}))) as {
      datasets?: Dataset[];
      error?: string;
    };

    if (!listResponse.ok) {
      throw new Error(listPayload.error || "Failed to load datasets.");
    }

    const first = listPayload.datasets?.[0];
    if (first) {
      return first;
    }

    const createResponse = await fetch("/api/v2/datasets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: currentProjectId,
        name: "Primary Dataset",
        description: "Default dataset for uploads.",
      }),
    });
    const createPayload = (await createResponse.json().catch(() => ({}))) as {
      dataset?: Dataset;
      error?: string;
    };
    if (!createResponse.ok || !createPayload.dataset) {
      throw new Error(createPayload.error || "Failed to create dataset.");
    }

    return createPayload.dataset;
  }

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const projectResponse = await fetch(`/api/v2/projects/${projectId}`, { cache: "no-store" });
      const projectPayload = (await projectResponse.json().catch(() => ({}))) as {
        project?: Project;
        error?: string;
      };
      if (!projectResponse.ok || !projectPayload.project) {
        throw new Error(projectPayload.error || "Project not found.");
      }
      setProject(projectPayload.project);

      const dataset = await ensureDataset(projectId);
      setDatasetId(dataset.id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load upload workspace.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!datasetId) {
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      try {
        await loadUploadJobs({ hydratePreview: true, silent: true });
      } catch (jobError) {
        if (!cancelled) {
          setError(jobError instanceof Error ? jobError.message : "Failed to load upload jobs.");
        }
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, projectId, activeJobId, previewAssetId]);

  async function fetchPreviewAsset(assetId: string) {
    const response = await fetch(`/api/v2/assets/${assetId}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as {
      asset?: BatchAsset;
      error?: string;
    };
    if (!response.ok || !payload.asset) {
      throw new Error(payload.error || "Failed to load preview asset.");
    }
    return payload.asset;
  }

  async function loadUploadJobs(options?: { hydratePreview?: boolean; silent?: boolean }) {
    const hydratePreview = options?.hydratePreview ?? true;
    const silent = options?.silent ?? false;

    const response = await fetch(`/api/v2/projects/${projectId}/upload-jobs?limit=25`, {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      jobs?: UploadScanJob[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load upload jobs.");
    }

    const nextJobs = payload.jobs ?? [];
    setJobs(nextJobs);

    const current = nextJobs.find((job) => job.id === activeJobId) ?? nextJobs[0] ?? null;
    if (current && current.id !== activeJobId) {
      setActiveJobId(current.id);
    }

    if (!silent && current?.message) {
      setMessage(current.message);
    }

    if (hydratePreview && current?.preview_asset_id && current.preview_asset_id !== previewAssetId) {
      try {
        const asset = await fetchPreviewAsset(current.preview_asset_id);
        setPreviewAsset(asset);
        setPreviewAssetId(current.preview_asset_id);
      } catch (assetError) {
        if (!silent) {
          setError(assetError instanceof Error ? assetError.message : "Failed to load preview.");
        }
      }
    }
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const files = Array.from(fileList);
    const incoming = files.filter((file) => isSupportedUploadFile(file));
    const skipped = files.filter((file) => !isSupportedUploadFile(file));
    if (skipped.length > 0) {
      const examples = skipped
        .slice(0, 2)
        .map((file) => file.name)
        .join(", ");
      const suffix = skipped.length > 2 ? ` and ${skipped.length - 2} more` : "";
      setError(
        `Skipped unsupported file(s): ${examples}${suffix}. Use image or video files.`,
      );
    } else {
      setError(null);
    }

    if (incoming.length === 0) {
      return;
    }

    setSelectedFiles((previous) => {
      const key = new Set(previous.map((file) => `${file.name}-${file.size}-${file.lastModified}`));
      const merged = [...previous];
      for (const file of incoming) {
        const nextKey = `${file.name}-${file.size}-${file.lastModified}`;
        if (!key.has(nextKey)) {
          key.add(nextKey);
          merged.push(file);
        }
      }
      return merged;
    });
  }

  async function onCreateBatch() {
    if (!datasetId) {
      setError("Dataset is not ready yet.");
      return;
    }

    if (selectedFiles.length === 0) {
      setError("Select at least one file.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const prompt = scanPrompt.trim();
      const sourceArtifactIds: string[] = [];

      for (const file of selectedFiles) {
        const form = new FormData();
        form.append("file", file);
        const uploadResponse = await fetch("/api/v1/uploads", {
          method: "POST",
          body: form,
        });
        const uploadPayload = (await uploadResponse
          .json()
          .catch(() => ({}))) as UploadArtifactResponse & { error?: string };
        if (!uploadResponse.ok || !uploadPayload.artifact?.id) {
          throw new Error(uploadPayload.error || `Upload failed for ${file.name}.`);
        }

        sourceArtifactIds.push(uploadPayload.artifact.id);
      }

      const sourceType = selectedFiles.length ? inferSourceType(selectedFiles) : "mixed";
      const createJobResponse = await fetch(`/api/v2/projects/${projectId}/upload-jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          datasetId,
          batchName: batchName.trim() || defaultBatchName(),
          sourceType,
          sourceArtifactIds,
          reasoningEffort,
          scanPrompt: prompt || undefined,
          qualityMode: "dense",
        }),
      });
      const createJobPayload = (await createJobResponse.json().catch(() => ({}))) as {
        job?: UploadScanJob;
        error?: string;
      };

      if (!createJobResponse.ok || !createJobPayload.job) {
        throw new Error(createJobPayload.error || "Failed to start upload scan job.");
      }

      setJobs((previous) => {
        const filtered = previous.filter((job) => job.id !== createJobPayload.job?.id);
        return createJobPayload.job ? [createJobPayload.job, ...filtered] : filtered;
      });
      setActiveJobId(createJobPayload.job.id);
      setShowCocoJson(false);
      setCocoPreviewText(null);
      setSelectedFiles([]);
      setBatchName(defaultBatchName());
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      if (folderInputRef.current) {
        folderInputRef.current.value = "";
      }
      setMessage("Upload accepted. Auto-label job is running in the background.");
      await loadUploadJobs({ hydratePreview: true, silent: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create batch.");
    } finally {
      setBusy(false);
    }
  }

  const fileSummary = useMemo(() => {
    const imageCount = selectedFiles.filter((file) => file.type.startsWith("image/")).length;
    const videoCount = selectedFiles.filter((file) => file.type.startsWith("video/")).length;
    return { imageCount, videoCount };
  }, [selectedFiles]);
  const activeJob = jobs.find((job) => job.id === activeJobId) ?? jobs[0] ?? null;
  const hasRunningJobs = jobs.some((job) => isJobRunning(job.status));

  const previewShapes = previewAsset?.latest_annotation?.shapes ?? [];
  const canExport = Boolean(previewAsset && previewShapes.length > 0);

  function resolvePreviewImageSize() {
    if (!previewAsset) {
      return null;
    }
    const image = previewImageRef.current;
    const width = image?.naturalWidth || previewAsset.width || 0;
    const height = image?.naturalHeight || previewAsset.height || 0;
    if (width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  }

  async function downloadAnnotatedImage() {
    if (!previewAsset) {
      return;
    }
    const image = previewImageRef.current;
    if (!image || !image.complete) {
      setError("Preview image is not ready yet.");
      return;
    }
    const size = resolvePreviewImageSize();
    if (!size) {
      setError("Unable to resolve image dimensions for export.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Unable to render annotated image.");
      return;
    }

    context.drawImage(image, 0, 0, size.width, size.height);
    context.lineWidth = Math.max(2, Math.round(size.width * 0.002));
    context.strokeStyle = "#10b981";
    context.textBaseline = "top";
    context.font = `600 ${Math.max(12, Math.round(size.width * 0.015))}px ui-sans-serif, system-ui`;

    for (const shape of previewShapes) {
      const x = Math.max(0, Math.min(size.width - 1, shape.geometry.x * size.width));
      const y = Math.max(0, Math.min(size.height - 1, shape.geometry.y * size.height));
      const width = Math.max(1, Math.min(size.width - x, shape.geometry.width * size.width));
      const height = Math.max(1, Math.min(size.height - y, shape.geometry.height * size.height));

      context.strokeRect(x, y, width, height);
      const label = shape.label.trim() || "object";
      const paddingX = 6;
      const paddingY = 4;
      const textMetrics = context.measureText(label);
      const labelWidth = textMetrics.width + paddingX * 2;
      const labelHeight = Math.max(16, Math.round(size.height * 0.03));
      const labelY = Math.max(0, y - labelHeight - 2);

      context.fillStyle = "#10b981";
      context.fillRect(x, labelY, labelWidth, labelHeight);
      context.fillStyle = "#ffffff";
      context.fillText(label, x + paddingX, labelY + paddingY);
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), "image/png");
    });
    if (!blob) {
      setError("Unable to generate annotated PNG.");
      return;
    }
    downloadBlob(`${previewAsset.id}_annotated.png`, blob);
  }

  function buildCocoExport() {
    if (!previewAsset) {
      return null;
    }
    const size = resolvePreviewImageSize();
    if (!size) {
      return null;
    }

    const categoryIdByLabel = new Map<string, number>();
    const categories: Array<{ id: number; name: string; supercategory: string }> = [];
    const annotations: Array<{
      id: number;
      image_id: number;
      category_id: number;
      bbox: [number, number, number, number];
      area: number;
      iscrowd: number;
    }> = [];

    let annotationId = 1;
    for (const shape of previewShapes) {
      const label = shape.label.trim() || "object";
      let categoryId = categoryIdByLabel.get(label);
      if (!categoryId) {
        categoryId = categoryIdByLabel.size + 1;
        categoryIdByLabel.set(label, categoryId);
        categories.push({ id: categoryId, name: label, supercategory: "object" });
      }

      const x = Math.max(0, Math.min(size.width - 1, shape.geometry.x * size.width));
      const y = Math.max(0, Math.min(size.height - 1, shape.geometry.y * size.height));
      const width = Math.max(1, Math.min(size.width - x, shape.geometry.width * size.width));
      const height = Math.max(1, Math.min(size.height - y, shape.geometry.height * size.height));

      annotations.push({
        id: annotationId,
        image_id: 1,
        category_id: categoryId,
        bbox: [x, y, width, height],
        area: width * height,
        iscrowd: 0,
      });
      annotationId += 1;
    }

    return {
      info: {
        description: "Flowstate auto-label export",
        version: "1.0",
        date_created: new Date().toISOString(),
      },
      licenses: [],
      images: [
        {
          id: 1,
          file_name: `${previewAsset.id}.png`,
          width: size.width,
          height: size.height,
        },
      ],
      annotations,
      categories,
    };
  }

  function downloadCocoJson() {
    const coco = buildCocoExport();
    if (!coco) {
      setError("Unable to generate COCO JSON for this asset.");
      return;
    }
    const blob = new Blob([JSON.stringify(coco, null, 2)], {
      type: "application/json",
    });
    downloadBlob(`${previewAsset?.id ?? "annotations"}_coco.json`, blob);
  }

  function toggleCocoJsonPreview() {
    if (showCocoJson) {
      setShowCocoJson(false);
      return;
    }
    const coco = buildCocoExport();
    if (!coco) {
      setError("Unable to render COCO JSON on screen yet.");
      return;
    }
    setError(null);
    setCocoPreviewText(JSON.stringify(coco, null, 2));
    setShowCocoJson(true);
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Upload</h1>
        <p className="text-sm text-muted-foreground">{project?.name ?? "Project"}</p>
      </div>

      <div className="grid gap-5">
        <Card>
          <CardContent className="space-y-5 p-5">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium">Batch Name</span>
                <Input value={batchName} onChange={(event) => setBatchName(event.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Reasoning</span>
                <NativeSelect
                  value={reasoningEffort}
                  onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </NativeSelect>
              </label>
            </div>

            <label className="space-y-1">
              <span className="text-sm font-medium">Scan Instructions (optional)</span>
              <Input
                value={scanPrompt}
                onChange={(event) => setScanPrompt(event.target.value)}
                placeholder="e.g. Find all dogs in the image and label only dogs."
              />
            </label>

            <p className="text-sm text-muted-foreground">
              Upload and Process automatically runs OpenAI auto-labeling and opens the result.
            </p>

            <div
              className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center lg:p-12"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                addFiles(event.dataTransfer.files);
              }}
            >
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-2xl font-semibold tracking-tight">Drag and drop files</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload images or videos. Videos are auto-trimmed to 3s and capped at 20MB, then
                sampled into frames.
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept="image/*,video/*,.jpg,.jpeg,.png,.webp,.mp4,.mov,.m4v,.avi,.mkv,.webm"
                  onChange={(event) => addFiles(event.target.files)}
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => addFiles(event.target.files)}
                />
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  Add Files
                </Button>
                <Button variant="outline" onClick={() => folderInputRef.current?.click()}>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Add Folder
                </Button>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Images: {fileSummary.imageCount}</Badge>
                <Badge variant="outline">Videos: {fileSummary.videoCount}</Badge>
                <Badge variant="outline">Total: {selectedFiles.length}</Badge>
              </div>

              <div className="mx-auto mt-6 w-full max-w-xl rounded-lg border border-border/80 bg-background/90 p-3">
                <p className="text-xs font-medium text-muted-foreground">Supported Formats</p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
                  <Badge variant="secondary">Images (.jpg, .png, .webp)</Badge>
                  <Badge variant="secondary">Videos (.mp4, .mov)</Badge>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Videos are normalized to first 3 seconds and max 20MB on upload.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void onCreateBatch()} disabled={busy || loading}>
                {busy ? "Uploading..." : "Upload and Process"}
              </Button>
              {selectedFiles.length > 0 ? (
                <Button variant="ghost" onClick={() => setSelectedFiles([])} disabled={busy}>
                  Clear Files
                </Button>
              ) : null}
            </div>

            {message ? (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </CardContent>
        </Card>

        {jobs.length > 0 ? (
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Recent jobs</p>
                  <p className="text-xs text-muted-foreground">
                    {hasRunningJobs ? "Processing in background." : "No active processing right now."}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadUploadJobs({ hydratePreview: true })}
                  disabled={busy}
                >
                  Refresh
                </Button>
              </div>

              <div className="space-y-2">
                {jobs.map((job) => {
                  const selected = activeJob?.id === job.id;
                  const progressPercent =
                    typeof job.progress === "number"
                      ? Math.max(0, Math.min(100, Math.round(job.progress * 100)))
                      : null;
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={async () => {
                        setActiveJobId(job.id);
                        if (job.preview_asset_id) {
                          try {
                            const asset = await fetchPreviewAsset(job.preview_asset_id);
                            setPreviewAsset(asset);
                            setPreviewAssetId(job.preview_asset_id);
                          } catch (assetError) {
                            setError(
                              assetError instanceof Error
                                ? assetError.message
                                : "Failed to load preview asset.",
                            );
                          }
                        }
                      }}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        selected
                          ? "border-primary/60 bg-primary/5"
                          : "border-border/80 bg-muted/20 hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{job.batch_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {stageLabel(job.stage)} • {job.labeled_assets_count} labeled •{" "}
                            {job.failed_assets_count} failed
                          </p>
                        </div>
                        <Badge
                          variant={
                            job.status === "completed"
                              ? "secondary"
                              : job.status === "failed"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {job.status}
                        </Badge>
                      </div>

                      {progressPercent !== null ? (
                        <div className="mt-2">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full transition-all ${
                                job.status === "failed"
                                  ? "bg-destructive"
                                  : job.status === "completed"
                                    ? "bg-emerald-500"
                                    : "bg-primary"
                              }`}
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {progressPercent}% • {job.message || "Running"}
                          </p>
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {activeJob ? (
                <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {activeJob.status === "completed" ? (
                      <CircleCheck className="h-4 w-4 text-emerald-500" />
                    ) : null}
                    {activeJob.status === "failed" ? (
                      <CircleX className="h-4 w-4 text-destructive" />
                    ) : null}
                    {isJobRunning(activeJob.status) ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : null}
                    <p className="text-sm font-medium">{activeJob.message || stageLabel(activeJob.stage)}</p>
                  </div>
                  {activeJob.error_message ? (
                    <p className="text-sm text-destructive">{activeJob.error_message}</p>
                  ) : null}
                  <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-background p-3 text-xs">
                    {(activeJob.logs.length > 0
                      ? activeJob.logs.slice(-12).join("\n")
                      : "No logs yet.")}
                  </pre>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {previewAsset ? (
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Auto-label result</p>
                  <p className="text-xs text-muted-foreground">
                    {previewAsset.latest_annotation?.shapes.length ?? 0} labels detected
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      router.push(`/projects/${projectId}/annotate?assetId=${encodeURIComponent(previewAsset.id)}`)
                    }
                  >
                    Open in Annotate
                  </Button>
                  <Button variant="outline" onClick={() => void downloadAnnotatedImage()} disabled={!canExport}>
                    Download annotated image
                  </Button>
                  <Button variant="outline" onClick={downloadCocoJson} disabled={!canExport}>
                    Download COCO JSON
                  </Button>
                  <Button variant="outline" onClick={toggleCocoJsonPreview} disabled={!canExport}>
                    {showCocoJson ? "Hide COCO JSON" : "View COCO JSON"}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
                <p>
                  I annotated this upload and produced:
                </p>
                <p>1. An image with bounding boxes and labels.</p>
                <p>2. COCO-format annotations for detected instances.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  For dense montages and low-resolution tiles, labels are best-effort.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-muted/20 p-2">
                <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={previewImageRef}
                    src={`/api/v2/assets/${previewAsset.id}/file`}
                    alt="Auto-labeled preview"
                    className="block h-auto max-h-[640px] w-auto max-w-full"
                    draggable={false}
                  />
                  <div className="pointer-events-none absolute inset-0">
                    {previewAsset.latest_annotation?.shapes.map((shape) =>
                      shape.geometry.type === "bbox" ? (
                        <div
                          key={shape.id}
                          className="absolute border-2 border-emerald-500/90"
                          style={{
                            left: `${shape.geometry.x * 100}%`,
                            top: `${shape.geometry.y * 100}%`,
                            width: `${shape.geometry.width * 100}%`,
                            height: `${shape.geometry.height * 100}%`,
                          }}
                        >
                          <span className="absolute left-0 top-0 -translate-y-full rounded bg-emerald-600 px-1 py-0.5 text-[10px] text-white">
                            {shape.label}
                          </span>
                        </div>
                      ) : null,
                    )}
                  </div>
                </div>
              </div>

              {showCocoJson ? (
                <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
                  <p className="text-sm font-medium">COCO JSON</p>
                  <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-background p-3 text-xs">
                    {cocoPreviewText ?? "No COCO JSON available yet."}
                  </pre>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </section>
  );
}
