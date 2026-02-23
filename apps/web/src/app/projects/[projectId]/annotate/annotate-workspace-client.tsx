"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";
import { Input } from "@shadcn-ui/input";
import { NativeSelect } from "@shadcn-ui/native-select";

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
  identity?: {
    possible_name: string;
    confidence: number | null;
    evidence: string | null;
  } | null;
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

type AutoLabelModelOutput = {
  shapes: Array<{
    label: string;
    confidence: number | null;
    possible_name: string | null;
    identity_confidence: number | null;
    identity_evidence: string | null;
    bbox: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
};

type ReasoningEffort = "low" | "medium" | "high";
type LabelSummary = {
  label: string;
  count: number;
  avgConfidence: number | null;
  minConfidence: number | null;
  maxConfidence: number | null;
};

const ASSET_PAGE_SIZE = 18;

function formatConfidence(confidence: number | null) {
  if (confidence == null) {
    return "n/a";
  }

  return `${Math.round(confidence * 100)}%`;
}

function displayShapeLabel(shape: AnnotationShape) {
  if (!shape.identity?.possible_name) {
    return shape.label;
  }
  if ((shape.identity.confidence ?? 0) < 0.62) {
    return shape.label;
  }
  return `${shape.label}: ${shape.identity.possible_name}`;
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
  const searchParams = useSearchParams();
  const requestedAssetId = searchParams.get("assetId") ?? "";
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [lastModelOutput, setLastModelOutput] = useState<AutoLabelModelOutput | null>(null);
  const [showLabelInstances, setShowLabelInstances] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetStatusFilter, setAssetStatusFilter] = useState<"all" | "labeled" | "pending">("all");
  const [assetSortOrder, setAssetSortOrder] = useState<"newest" | "oldest">("newest");
  const [assetPage, setAssetPage] = useState(0);
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
      const preferredAsset =
        (requestedAssetId
          ? nextAssets.find((asset) => asset.id === requestedAssetId && isImageLikeAsset(asset.asset_type))
          : null) ?? nextAssets.find((asset) => isImageLikeAsset(asset.asset_type));
      if (preferredAsset && !nextAssets.some((asset) => asset.id === selectedAssetId)) {
        setSelectedAssetId(preferredAsset.id);
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

  useEffect(() => {
    if (!requestedAssetId) {
      return;
    }
    if (!supportedAssets.some((asset) => asset.id === requestedAssetId)) {
      return;
    }
    setSelectedAssetId(requestedAssetId);
  }, [requestedAssetId, supportedAssets]);

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
    setLastModelOutput(null);

    try {
      const response = await fetch(`/api/v2/assets/${selectedAsset.id}/auto-label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reasoningEffort }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        annotation?: AnnotationRecord;
        model_output?: AutoLabelModelOutput;
        error?: string;
      };
      if (!response.ok || !payload.annotation) {
        throw new Error(payload.error || "Auto-label failed.");
      }

      setLastModelOutput(payload.model_output ?? null);
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
    setLastModelOutput(null);

    try {
      const response = await fetch(`/api/v2/batches/${selectedAsset.batch_id}/auto-label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filter: "unlabeled", maxAssets: 300, reasoningEffort }),
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
  const labels = useMemo(() => selectedAsset?.latest_annotation?.shapes ?? [], [selectedAsset]);
  const filteredAssets = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();

    return [...supportedAssets]
      .filter((asset) => {
        if (assetStatusFilter === "labeled" && !asset.latest_annotation) {
          return false;
        }
        if (assetStatusFilter === "pending" && asset.latest_annotation) {
          return false;
        }
        if (!query) {
          return true;
        }
        const label = assetDisplayLabel(asset).toLowerCase();
        const id = asset.id.toLowerCase();
        return label.includes(query) || id.includes(query);
      })
      .sort((left, right) => {
        const leftOrder = left.frame_index ?? Number.MIN_SAFE_INTEGER;
        const rightOrder = right.frame_index ?? Number.MIN_SAFE_INTEGER;

        if (leftOrder !== rightOrder) {
          return assetSortOrder === "newest" ? rightOrder - leftOrder : leftOrder - rightOrder;
        }
        return assetSortOrder === "newest"
          ? right.id.localeCompare(left.id)
          : left.id.localeCompare(right.id);
      });
  }, [assetSearch, assetSortOrder, assetStatusFilter, supportedAssets]);
  const pageCount = Math.max(1, Math.ceil(filteredAssets.length / ASSET_PAGE_SIZE));
  const pagedAssets = useMemo(() => {
    const start = assetPage * ASSET_PAGE_SIZE;
    return filteredAssets.slice(start, start + ASSET_PAGE_SIZE);
  }, [assetPage, filteredAssets]);
  const selectedAssetPosition = useMemo(
    () => (selectedAsset ? filteredAssets.findIndex((asset) => asset.id === selectedAsset.id) : -1),
    [filteredAssets, selectedAsset],
  );
  const hasPreviousAsset = selectedAssetPosition > 0;
  const hasNextAsset = selectedAssetPosition >= 0 && selectedAssetPosition < filteredAssets.length - 1;

  function selectRelativeAsset(offset: -1 | 1) {
    if (selectedAssetPosition < 0) {
      return;
    }
    const targetIndex = selectedAssetPosition + offset;
    if (targetIndex < 0 || targetIndex >= filteredAssets.length) {
      return;
    }
    const target = filteredAssets[targetIndex];
    if (!target) {
      return;
    }
    setSelectedAssetId(target.id);
    setAssetPage(Math.floor(targetIndex / ASSET_PAGE_SIZE));
  }

  useEffect(() => {
    setAssetPage(0);
  }, [assetSearch, assetSortOrder, assetStatusFilter]);

  useEffect(() => {
    if (assetPage > pageCount - 1) {
      setAssetPage(Math.max(0, pageCount - 1));
    }
  }, [assetPage, pageCount]);

  useEffect(() => {
    if (filteredAssets.length === 0) {
      return;
    }
    if (selectedAsset && filteredAssets.some((asset) => asset.id === selectedAsset.id)) {
      return;
    }
    setSelectedAssetId(filteredAssets[0]!.id);
  }, [filteredAssets, selectedAsset]);
  const labelSummaries = useMemo<LabelSummary[]>(() => {
    const grouped = new Map<
      string,
      {
        count: number;
        confidenceValues: number[];
      }
    >();

    for (const shape of labels) {
      const key = displayShapeLabel(shape);
      const entry = grouped.get(key) ?? { count: 0, confidenceValues: [] };
      entry.count += 1;
      if (shape.confidence != null) {
        entry.confidenceValues.push(shape.confidence);
      }
      grouped.set(key, entry);
    }

    return [...grouped.entries()]
      .map(([label, entry]) => {
        const values = entry.confidenceValues;
        return {
          label,
          count: entry.count,
          avgConfidence:
            values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
          minConfidence: values.length > 0 ? Math.min(...values) : null,
          maxConfidence: values.length > 0 ? Math.max(...values) : null,
        };
      })
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.label.localeCompare(right.label);
      });
  }, [labels]);

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
          <Badge variant="outline">{filteredAssets.length} visible</Badge>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Reasoning</span>
            <NativeSelect
              value={reasoningEffort}
              onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
              className="h-8 min-w-[110px]"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </NativeSelect>
          </label>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="lg:sticky lg:top-4 lg:h-fit">
          <CardHeader className="space-y-3">
            <CardTitle className="text-base">Assets</CardTitle>
            <div className="space-y-2">
              <Input
                value={assetSearch}
                onChange={(event) => setAssetSearch(event.target.value)}
                placeholder="Search frame or asset id"
                className="h-9"
              />
              <div className="grid grid-cols-2 gap-2">
                <NativeSelect
                  value={assetStatusFilter}
                  onChange={(event) =>
                    setAssetStatusFilter(event.target.value as "all" | "labeled" | "pending")
                  }
                  className="h-9"
                >
                  <option value="all">All</option>
                  <option value="labeled">Labeled</option>
                  <option value="pending">Pending</option>
                </NativeSelect>
                <NativeSelect
                  value={assetSortOrder}
                  onChange={(event) => setAssetSortOrder(event.target.value as "newest" | "oldest")}
                  className="h-9"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </NativeSelect>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
            {!loading && supportedAssets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Upload images or videos to label.</p>
            ) : null}
            {!loading && filteredAssets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assets match these filters.</p>
            ) : null}
            <div className="max-h-[50vh] space-y-1 overflow-auto pr-1">
              {pagedAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setSelectedAssetId(asset.id)}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    selectedAsset?.id === asset.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{assetDisplayLabel(asset)}</p>
                    <Badge variant={asset.latest_annotation ? "secondary" : "outline"} className="shrink-0">
                      {asset.latest_annotation ? "labeled" : "pending"}
                    </Badge>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{asset.id.slice(0, 12)}</p>
                </button>
              ))}
            </div>
            {filteredAssets.length > 0 ? (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground">
                  Page {assetPage + 1} / {pageCount}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAssetPage((current) => Math.max(0, current - 1))}
                    disabled={assetPage === 0}
                  >
                    Prev
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAssetPage((current) => Math.min(pageCount - 1, current + 1))}
                    disabled={assetPage >= pageCount - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
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
                                  {displayShapeLabel(shape)}
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => selectRelativeAsset(-1)}
                  disabled={busy || !hasPreviousAsset}
                >
                  Prev frame
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => selectRelativeAsset(1)}
                  disabled={busy || !hasNextAsset}
                >
                  Next frame
                </Button>
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
            <CardContent className="space-y-3">
              {labels.length === 0 ? (
                <p className="text-sm text-muted-foreground">No labels yet. Run OpenAI auto-label.</p>
              ) : null}
              {labels.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{labels.length} boxes</Badge>
                    <Badge variant="outline">{labelSummaries.length} unique labels</Badge>
                    {labelSummaries.slice(0, 6).map((summary) => (
                      <Badge key={summary.label} variant="outline">
                        {summary.label} x{summary.count}
                      </Badge>
                    ))}
                    {labelSummaries.length > 6 ? (
                      <Badge variant="outline">+{labelSummaries.length - 6} more</Badge>
                    ) : null}
                  </div>

                  <div className="overflow-hidden rounded-lg border border-border">
                    <div className="grid grid-cols-[minmax(0,1fr)_80px_90px_120px] gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                      <span>Label</span>
                      <span className="text-right">Count</span>
                      <span className="text-right">Avg</span>
                      <span className="text-right">Range</span>
                    </div>
                    <div className="max-h-56 overflow-auto">
                      {labelSummaries.map((summary) => (
                        <div
                          key={summary.label}
                          className="grid grid-cols-[minmax(0,1fr)_80px_90px_120px] gap-2 border-b border-border/70 px-3 py-2 text-sm last:border-b-0"
                        >
                          <span className="truncate font-medium">{summary.label}</span>
                          <span className="text-right text-muted-foreground">{summary.count}</span>
                          <span className="text-right text-muted-foreground">
                            {formatConfidence(summary.avgConfidence)}
                          </span>
                          <span className="text-right text-muted-foreground">
                            {summary.minConfidence == null || summary.maxConfidence == null
                              ? "n/a"
                              : `${formatConfidence(summary.minConfidence)} - ${formatConfidence(summary.maxConfidence)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Grouped by label to reduce scrolling.</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowLabelInstances((current) => !current)}
                    >
                      {showLabelInstances ? "Hide instances" : "Show instances"}
                    </Button>
                  </div>

                  {showLabelInstances ? (
                    <div className="max-h-56 space-y-2 overflow-auto rounded-lg border border-border p-2">
                      {labels.map((shape) => (
                        <div
                          key={shape.id}
                          className="flex items-center justify-between rounded-md border border-border/70 px-2 py-1.5"
                        >
                          <p className="truncate text-xs font-medium">{displayShapeLabel(shape)}</p>
                          <p className="text-xs text-muted-foreground">
                            confidence {formatConfidence(shape.confidence)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">OpenAI Raw Output</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!lastModelOutput ? (
                <p className="text-sm text-muted-foreground">
                  Run auto-label to inspect the direct structured response returned by OpenAI.
                </p>
              ) : (
                <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-muted/20 p-3 text-xs">
                  {JSON.stringify(lastModelOutput, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>

          {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
