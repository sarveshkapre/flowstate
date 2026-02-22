"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Upload } from "lucide-react";

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

type Batch = {
  id: string;
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
  latest_annotation?: { id: string } | null;
};

type ReasoningEffort = "low" | "medium" | "high";

function defaultBatchName() {
  return `Uploaded on ${new Date().toLocaleString()}`;
}

function isSupportedUploadFile(file: File) {
  return file.type.startsWith("image/") || file.type.startsWith("video/");
}

function inferSourceType(files: File[]): "image" | "video" | "mixed" {
  const found = new Set<"image" | "video">();
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      found.add("image");
      continue;
    }

    if (file.type.startsWith("video/")) {
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

export function UploadWorkspaceClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [batchName, setBatchName] = useState(defaultBatchName);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

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

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const incoming = Array.from(fileList).filter((file) => isSupportedUploadFile(file));
    if (incoming.length !== fileList.length) {
      setError("Some files were skipped. Please upload images and videos only.");
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
      const createBatchResponse = await fetch(`/api/v2/datasets/${datasetId}/batches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: batchName.trim() || defaultBatchName(),
          sourceType,
          sourceArtifactIds,
        }),
      });
      const createBatchPayload = (await createBatchResponse.json().catch(() => ({}))) as {
        batch?: Batch;
        error?: string;
      };

      if (!createBatchResponse.ok || !createBatchPayload.batch) {
        throw new Error(createBatchPayload.error || "Failed to create batch.");
      }

      const ingestResponse = await fetch(`/api/v2/batches/${createBatchPayload.batch.id}/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const ingestPayload = (await ingestResponse.json().catch(() => ({}))) as {
        result?: {
          created_assets_count?: number;
          failed_extraction_artifact_ids?: string[];
          extraction_errors?: Array<{ artifact_id?: string; message?: string }>;
        };
        error?: string;
      };

      if (!ingestResponse.ok && ingestResponse.status !== 409) {
        throw new Error(ingestPayload.error || "Batch ingest failed.");
      }

      let autoLabelMessage = "";
      let labeledAssetId: string | null = null;
      if ((ingestPayload.result?.created_assets_count ?? 0) > 0) {
        const autoLabelResponse = await fetch(
          `/api/v2/batches/${createBatchPayload.batch.id}/auto-label`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              filter: "unlabeled",
              reasoningEffort,
            }),
          },
        );
        const autoLabelPayload = (await autoLabelResponse.json().catch(() => ({}))) as {
          processed?: number;
          results?: Array<{ assetId: string }>;
          errors?: Array<{ assetId: string; error: string }>;
          error?: string;
        };

        if (!autoLabelResponse.ok) {
          autoLabelMessage = ` Batch auto-label failed: ${autoLabelPayload.error || "unknown error"}`;
        } else if (autoLabelPayload.processed && autoLabelPayload.processed > 0) {
          autoLabelMessage = ` AI labeled ${autoLabelPayload.processed} asset(s).`;
          labeledAssetId = autoLabelPayload.results?.[0]?.assetId ?? null;
        } else if (autoLabelPayload.errors && autoLabelPayload.errors.length > 0) {
          autoLabelMessage = " AI labeling completed with errors.";
        }
      }

      if (!labeledAssetId && (ingestPayload.result?.created_assets_count ?? 0) > 0) {
        const assetsResponse = await fetch(
          `/api/v2/projects/${projectId}/assets?batchId=${encodeURIComponent(
            createBatchPayload.batch.id,
          )}&includeLatestAnnotation=true&limit=200`,
          {
            cache: "no-store",
          },
        );
        const assetsPayload = (await assetsResponse.json().catch(() => ({}))) as {
          assets?: BatchAsset[];
        };
        const assets = assetsPayload.assets ?? [];
        const withAnnotation = assets.find(
          (asset) =>
            (asset.asset_type === "image" || asset.asset_type === "video_frame") &&
            asset.latest_annotation,
        );
        const firstRenderable = assets.find(
          (asset) => asset.asset_type === "image" || asset.asset_type === "video_frame",
        );
        labeledAssetId = withAnnotation?.id ?? firstRenderable?.id ?? null;
      }

      setSelectedFiles([]);
      setBatchName(defaultBatchName());
      const createdCount = ingestPayload.result?.created_assets_count ?? 0;
      const failedExtractionCount =
        ingestPayload.result?.failed_extraction_artifact_ids?.length ?? 0;
      if (failedExtractionCount > 0) {
        const firstError = ingestPayload.result?.extraction_errors?.[0]?.message;
        const suffix = firstError ? ` ${firstError}` : "";
        setMessage(
          `Batch ingested with ${createdCount} assets. Video extraction failed for ${failedExtractionCount} file(s).${suffix}${autoLabelMessage}`,
        );
      } else {
        setMessage(
          (createdCount ? `Batch ready with ${createdCount} assets.` : "Batch created.") + autoLabelMessage,
        );
      }

      if (labeledAssetId) {
        router.push(`/projects/${projectId}/annotate?assetId=${encodeURIComponent(labeledAssetId)}`);
      } else if (createdCount > 0) {
        router.push(`/projects/${projectId}/annotate`);
      }
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
                  Upload images or short videos. Videos are sampled into frames automatically.
                </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept="image/*,video/*"
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
      </div>
    </section>
  );
}
