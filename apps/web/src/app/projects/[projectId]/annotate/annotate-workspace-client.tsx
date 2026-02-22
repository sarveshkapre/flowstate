"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";

type Asset = {
  id: string;
  batch_id: string;
  artifact_id: string | null;
  asset_type: "image" | "video_frame" | "pdf_page";
  storage_path: string;
  frame_index: number | null;
  page_number: number | null;
  latest_annotation: AnnotationRecord | null;
};

type AnnotationShape = {
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
};

type AnnotationRecord = {
  id: string;
  source: "manual" | "ai_prelabel" | "imported";
  shapes: AnnotationShape[];
  updated_at: string;
};

function formatConfidence(confidence: number | null) {
  if (confidence == null) {
    return "n/a";
  }

  return `${Math.round(confidence * 100)}%`;
}

function assetPreviewUrl(asset: Asset | null) {
  if (!asset) {
    return null;
  }

  if (asset.storage_path.trim()) {
    return asset.storage_path;
  }

  if (!asset.artifact_id) {
    return null;
  }

  return `/api/v1/uploads/${asset.artifact_id}/file`;
}

function isImageLikeAsset(assetType: Asset["asset_type"]) {
  return assetType === "image" || assetType === "video_frame";
}

function assetDisplayLabel(asset: Asset) {
  if (asset.asset_type === "video_frame" && asset.frame_index != null) {
    return `frame ${asset.frame_index}`;
  }

  if (asset.asset_type === "pdf_page" && asset.page_number != null) {
    return `pdf page ${asset.page_number}`;
  }

  return asset.asset_type;
}

export function AnnotateWorkspaceClient({ projectId }: { projectId: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supportedAssets = useMemo(() => assets.filter((asset) => isImageLikeAsset(asset.asset_type)), [assets]);

  async function loadAssets() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/v2/projects/${projectId}/assets?includeLatestAnnotation=true&limit=800`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        assets?: Asset[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load assets.");
      }

      const nextAssets = payload.assets ?? [];
      setAssets(nextAssets);
      const firstSupportedAsset = nextAssets.find((asset) => isImageLikeAsset(asset.asset_type));
      if (firstSupportedAsset && !nextAssets.some((asset) => asset.id === selectedAssetId)) {
        setSelectedAssetId(firstSupportedAsset.id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load assets.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const selectedAsset = useMemo(
    () => supportedAssets.find((asset) => asset.id === selectedAssetId) ?? supportedAssets[0] ?? null,
    [supportedAssets, selectedAssetId],
  );

  const unlabeledCount = useMemo(
    () => supportedAssets.filter((asset) => !asset.latest_annotation).length,
    [supportedAssets],
  );

  async function runAutoLabelCurrent() {
    if (!selectedAsset) {
      setError("Select an asset first.");
      return;
    }

    if (!isImageLikeAsset(selectedAsset.asset_type)) {
      setError("Auto-label supports images and extracted video frames only.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/v2/assets/${selectedAsset.id}/auto-label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        annotation?: AnnotationRecord;
        error?: string;
      };
      if (!response.ok || !payload.annotation) {
        throw new Error(payload.error || "Auto-label failed.");
      }

      setMessage(`Auto-label added ${payload.annotation.shapes.length} label(s).`);
      await loadAssets();
    } catch (autoError) {
      setError(autoError instanceof Error ? autoError.message : "Auto-label failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runAutoLabelBatch() {
    if (!selectedAsset) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/v2/batches/${selectedAsset.batch_id}/auto-label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filter: "unlabeled", maxAssets: 300 }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        processed?: number;
        skipped?: number;
        errors?: Array<{ assetId: string; error: string }>;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Batch auto-label failed.");
      }

      const processed = payload.processed ?? 0;
      const skipped = payload.skipped ?? 0;
      const failed = payload.errors?.length ?? 0;
      setMessage(`Batch auto-label processed ${processed}, skipped ${skipped}, failed ${failed}.`);
      await loadAssets();
    } catch (batchError) {
      setError(batchError instanceof Error ? batchError.message : "Batch auto-label failed.");
    } finally {
      setBusy(false);
    }
  }

  const previewUrl = assetPreviewUrl(selectedAsset);
  const canAutoLabel = selectedAsset ? isImageLikeAsset(selectedAsset.asset_type) : false;
  const labels = selectedAsset?.latest_annotation?.shapes ?? [];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Annotate</h1>
          <p className="text-sm text-muted-foreground">
            OpenAI object detection and labels for image or short video uploads.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{supportedAssets.length} assets</Badge>
          <Badge variant="secondary">{unlabeledCount} pending</Badge>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader className="space-y-3">
            <CardTitle className="text-base">Assets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
            {!loading && supportedAssets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Upload images or videos to label.</p>
            ) : null}
            {supportedAssets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => setSelectedAssetId(asset.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  selectedAsset?.id === asset.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <p className="truncate text-sm font-medium">{assetDisplayLabel(asset)}</p>
                <p className="text-xs text-muted-foreground">{asset.id.slice(0, 10)}</p>
                <div className="mt-1">
                  <Badge variant={asset.latest_annotation ? "secondary" : "outline"}>
                    {asset.latest_annotation ? "labeled" : "pending"}
                  </Badge>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="rounded-xl border border-border bg-muted/20 p-2">
                {selectedAsset ? (
                  canAutoLabel ? (
                    previewUrl ? (
                      <div className="relative mx-auto w-fit">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewUrl}
                          alt="Asset preview"
                          className="mx-auto max-h-[520px] w-full rounded-lg object-contain"
                          draggable={false}
                        />
                        <div className="pointer-events-none absolute inset-0">
                          {labels.map((shape) =>
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
                    ) : (
                      <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                        Preview unavailable
                      </div>
                    )
                  ) : (
                    <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                      Select an image/video frame
                    </div>
                  )
                ) : (
                  <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                    Select an asset
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void runAutoLabelCurrent()} disabled={busy || !selectedAsset || !canAutoLabel}>
                  {busy ? "Labeling..." : "Auto-label this asset"}
                </Button>
                <Button variant="outline" onClick={() => void runAutoLabelBatch()} disabled={busy || !selectedAsset}>
                  {busy ? "Labeling..." : "Auto-label batch"}
                </Button>
                {selectedAsset?.storage_path ? (
                  <Button variant="ghost" asChild>
                    <a href={selectedAsset.storage_path} target="_blank" rel="noreferrer">
                      Open raw
                    </a>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detected Labels</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {labels.length === 0 ? (
                <p className="text-sm text-muted-foreground">No labels yet. Run OpenAI auto-label.</p>
              ) : null}
              {labels.map((shape) => (
                <div key={shape.id} className="flex items-center justify-between rounded-lg border border-border p-2">
                  <p className="text-sm font-medium">{shape.label}</p>
                  <p className="text-xs text-muted-foreground">confidence {formatConfidence(shape.confidence)}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
