"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Code2, FolderOpen, ImageIcon, QrCode, Smartphone, Upload } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";
import { Checkbox } from "@shadcn-ui/checkbox";
import { Input } from "@shadcn-ui/input";

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
  dataset_id: string;
  name: string;
  tags?: string[];
  source_type: "image" | "video" | "pdf" | "mixed";
  status:
    | "uploaded"
    | "preprocessing"
    | "ready_for_label"
    | "in_labeling"
    | "in_review"
    | "approved"
    | "rework"
    | "exported";
  item_count: number;
  created_at: string;
};

type UploadArtifactResponse = {
  artifact: {
    id: string;
    mime_type: string;
  };
};

function defaultBatchName() {
  return `Uploaded on ${new Date().toLocaleString()}`;
}

function inferSourceType(files: File[]): "image" | "video" | "pdf" | "mixed" {
  const found = new Set<"image" | "video" | "pdf">();
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      found.add("image");
      continue;
    }

    if (file.type.startsWith("video/")) {
      found.add("video");
      continue;
    }

    if (file.type === "application/pdf") {
      found.add("pdf");
    }
  }

  if (found.size !== 1) {
    return "mixed";
  }

  const first = found.values().next().value;
  return first ?? "mixed";
}

export function UploadWorkspaceClient({ projectId }: { projectId: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);

  const [batchName, setBatchName] = useState(defaultBatchName);
  const [tags, setTags] = useState("");
  const [createBatchInstantly, setCreateBatchInstantly] = useState(false);
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
    const listResponse = await fetch(`/api/v2/datasets?projectId=${encodeURIComponent(currentProjectId)}`, {
      cache: "no-store",
    });
    const listPayload = (await listResponse.json().catch(() => ({}))) as { datasets?: Dataset[]; error?: string };

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
    const createPayload = (await createResponse.json().catch(() => ({}))) as { dataset?: Dataset; error?: string };
    if (!createResponse.ok || !createPayload.dataset) {
      throw new Error(createPayload.error || "Failed to create dataset.");
    }

    return createPayload.dataset;
  }

  async function refreshBatches(currentDatasetId: string) {
    const response = await fetch(`/api/v2/datasets/${currentDatasetId}/batches?limit=20`, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { batches?: Batch[]; error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load batches.");
    }

    setBatches(payload.batches ?? []);
  }

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const projectResponse = await fetch(`/api/v2/projects/${projectId}`, { cache: "no-store" });
      const projectPayload = (await projectResponse.json().catch(() => ({}))) as { project?: Project; error?: string };
      if (!projectResponse.ok || !projectPayload.project) {
        throw new Error(projectPayload.error || "Project not found.");
      }
      setProject(projectPayload.project);

      const dataset = await ensureDataset(projectId);
      setDatasetId(dataset.id);
      await refreshBatches(dataset.id);
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

    const incoming = Array.from(fileList);
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

    if (!createBatchInstantly && selectedFiles.length === 0) {
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
        const uploadPayload = (await uploadResponse.json().catch(() => ({}))) as UploadArtifactResponse & { error?: string };
        if (!uploadResponse.ok || !uploadPayload.artifact?.id) {
          throw new Error(uploadPayload.error || `Upload failed for ${file.name}.`);
        }

        sourceArtifactIds.push(uploadPayload.artifact.id);
      }

      const sourceType = selectedFiles.length ? inferSourceType(selectedFiles) : "mixed";
      const parsedTags = tags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 40);
      const createBatchResponse = await fetch(`/api/v2/datasets/${datasetId}/batches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: batchName.trim() || defaultBatchName(),
          tags: parsedTags,
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

      await refreshBatches(datasetId);
      setSelectedFiles([]);
      setBatchName(defaultBatchName());
      setTags("");
      const createdCount = ingestPayload.result?.created_assets_count ?? 0;
      const failedExtractionCount = ingestPayload.result?.failed_extraction_artifact_ids?.length ?? 0;
      if (failedExtractionCount > 0) {
        const firstError = ingestPayload.result?.extraction_errors?.[0]?.message;
        const suffix = firstError ? ` ${firstError}` : "";
        setMessage(
          `Batch ingested with ${createdCount} assets. Video extraction failed for ${failedExtractionCount} file(s).${suffix}`,
        );
      } else {
        setMessage(createdCount ? `Batch ready with ${createdCount} assets.` : "Batch created.");
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
    const pdfCount = selectedFiles.filter((file) => file.type === "application/pdf").length;
    return { imageCount, videoCount, pdfCount };
  }, [selectedFiles]);

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Upload</h1>
        <p className="text-sm text-muted-foreground">{project?.name ?? "Project"}</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="space-y-5 p-5">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium">Batch Name</span>
                <Input value={batchName} onChange={(event) => setBatchName(event.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Tags</span>
                <Input
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="Search or add tags"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={createBatchInstantly} onCheckedChange={(value) => setCreateBatchInstantly(value === true)} />
              Create batch instantly
            </label>

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
              <p className="mt-1 text-sm text-muted-foreground">Images, videos, and PDFs.</p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept="image/*,video/*,application/pdf"
                  onChange={(event) => addFiles(event.target.files)}
                />
                <input ref={folderInputRef} type="file" multiple className="hidden" onChange={(event) => addFiles(event.target.files)} />
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <ImageIcon className="mr-2 h-4 w-4" />
                  Select Files
                </Button>
                <Button variant="outline" onClick={() => folderInputRef.current?.click()}>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Select Folder
                </Button>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Images: {fileSummary.imageCount}</Badge>
                <Badge variant="outline">Videos: {fileSummary.videoCount}</Badge>
                <Badge variant="outline">PDFs: {fileSummary.pdfCount}</Badge>
                <Badge variant="outline">Total: {selectedFiles.length}</Badge>
              </div>

              <div className="mx-auto mt-6 w-full max-w-xl rounded-lg border border-border/80 bg-background/90 p-3">
                <p className="text-xs font-medium text-muted-foreground">Supported Formats</p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
                  <Badge variant="secondary">Images (.jpg, .png, .webp)</Badge>
                  <Badge variant="secondary">Videos (.mp4, .mov)</Badge>
                  <Badge variant="secondary">PDFs (.pdf)</Badge>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void onCreateBatch()} disabled={busy || loading}>
                {busy ? "Uploading..." : "Create Batch"}
              </Button>
              {selectedFiles.length > 0 ? (
                <Button variant="ghost" onClick={() => setSelectedFiles([])} disabled={busy}>
                  Clear Files
                </Button>
              ) : null}
            </div>

            {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upload from your phone</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                  <Smartphone className="h-6 w-6" />
                </div>
                <div className="grid h-20 w-20 place-items-center rounded-md border border-border bg-background">
                  <QrCode className="h-10 w-10 text-muted-foreground" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Scan a QR code to send photos directly to this project.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Need sample images?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Search for images" />
              <Button variant="outline" className="w-full justify-between">
                Explore templates
                <ArrowRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bulk Upload Images</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Upload at scale using Flowstate API or worker automation hooks.
              </p>
              <Button variant="outline" className="w-full justify-between">
                <span className="inline-flex items-center gap-2">
                  <Code2 className="h-4 w-4" />
                  Learn More
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Batches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
          {!loading && batches.length === 0 ? <p className="text-sm text-muted-foreground">No batches yet.</p> : null}
          {batches.map((batch) => (
            <div key={batch.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">{batch.name}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(batch.created_at).toLocaleString()} • {batch.source_type}
                </p>
                {batch.tags?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {batch.tags.slice(0, 6).map((tag) => (
                      <Badge key={`${batch.id}-${tag}`} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{batch.status}</Badge>
                <Badge variant="secondary">{batch.item_count} assets</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
