"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Sparkles, Trash2, XCircle } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";
import { Input } from "@shadcn-ui/input";
import { NativeSelect } from "@shadcn-ui/native-select";

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

type Asset = {
  id: string;
  project_id: string;
  dataset_id: string;
  artifact_id: string | null;
  asset_type: "image" | "video_frame" | "pdf_page";
  storage_path: string;
  width: number | null;
  height: number | null;
  frame_index: number | null;
  latest_annotation: {
    id: string;
    source: "manual" | "ai_prelabel" | "imported";
    shapes: AnnotationShape[];
  } | null;
};

type DatasetRecord = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

type FilterStatus = "all" | "unlabeled" | "auto_labeled" | "reviewed";
type ReasoningEffort = "low" | "medium" | "high";
type DisplayItemKind = "image" | "video";

type DisplayItem = {
  id: string;
  kind: DisplayItemKind;
  datasetId: string;
  primaryAsset: Asset;
  assets: Asset[];
  labels: string[];
  shapeCount: number;
  lowestConfidence: number | null;
  status: FilterStatus;
};

function assetPreviewUrl(asset: Asset) {
  return `/api/v2/assets/${asset.id}/file`;
}

function deriveStatus(asset: Asset): FilterStatus {
  if (!asset.latest_annotation || asset.latest_annotation.shapes.length === 0) {
    return "unlabeled";
  }
  if (asset.latest_annotation.source === "ai_prelabel") {
    return "auto_labeled";
  }
  return "reviewed";
}

function deriveLowestConfidence(asset: Asset) {
  const shapes = asset.latest_annotation?.shapes ?? [];
  let lowest: number | null = null;
  for (const shape of shapes) {
    const confidence = shape.confidence;
    if (confidence == null) {
      lowest = lowest == null ? 0 : Math.min(lowest, 0);
      continue;
    }
    lowest = lowest == null ? confidence : Math.min(lowest, confidence);
  }
  return lowest;
}

function classNames(asset: Asset) {
  const set = new Set<string>();
  for (const shape of asset.latest_annotation?.shapes ?? []) {
    if (shape.label.trim()) {
      set.add(shape.label.trim());
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function classNamesForAssets(assets: Asset[]) {
  const set = new Set<string>();
  for (const asset of assets) {
    for (const name of classNames(asset)) {
      set.add(name);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function deriveStatusForAssets(assets: Asset[]) {
  if (assets.length === 0) {
    return "unlabeled" as const;
  }

  let allReviewed = true;
  let anyAuto = false;
  let anyLabeled = false;
  for (const asset of assets) {
    const status = deriveStatus(asset);
    if (status !== "reviewed") {
      allReviewed = false;
    }
    if (status === "auto_labeled") {
      anyAuto = true;
    }
    if (status !== "unlabeled") {
      anyLabeled = true;
    }
  }

  if (allReviewed) {
    return "reviewed" as const;
  }
  if (anyAuto) {
    return "auto_labeled" as const;
  }
  if (anyLabeled) {
    return "reviewed" as const;
  }
  return "unlabeled" as const;
}

function deriveLowestConfidenceForAssets(assets: Asset[]) {
  let lowest: number | null = null;
  for (const asset of assets) {
    const value = deriveLowestConfidence(asset);
    if (value == null) {
      continue;
    }
    lowest = lowest == null ? value : Math.min(lowest, value);
  }
  return lowest;
}

function buildDisplayItems(assets: Asset[]): DisplayItem[] {
  const groups = new Map<string, Asset[]>();

  for (const asset of assets) {
    const key =
      asset.asset_type === "video_frame" && asset.artifact_id
        ? `video:${asset.dataset_id}:${asset.artifact_id}`
        : `image:${asset.id}`;
    const list = groups.get(key) ?? [];
    list.push(asset);
    groups.set(key, list);
  }

  const items: DisplayItem[] = [];
  for (const [key, groupAssets] of groups.entries()) {
    const sorted = [...groupAssets].sort((left, right) => {
      const leftFrame = left.frame_index ?? Number.MAX_SAFE_INTEGER;
      const rightFrame = right.frame_index ?? Number.MAX_SAFE_INTEGER;
      if (leftFrame !== rightFrame) {
        return leftFrame - rightFrame;
      }
      return left.id.localeCompare(right.id);
    });
    const primaryAsset = sorted[0]!;
    const shapeCount = sorted.reduce(
      (count, asset) => count + (asset.latest_annotation?.shapes.length ?? 0),
      0,
    );

    items.push({
      id: key,
      kind: primaryAsset.asset_type === "video_frame" ? "video" : "image",
      datasetId: primaryAsset.dataset_id,
      primaryAsset,
      assets: sorted,
      labels: classNamesForAssets(sorted),
      shapeCount,
      lowestConfidence: deriveLowestConfidenceForAssets(sorted),
      status: deriveStatusForAssets(sorted),
    });
  }

  return items.sort((left, right) => right.primaryAsset.id.localeCompare(left.primaryAsset.id));
}

function confidenceLabel(value: number | null) {
  if (value == null) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

export function DatasetWorkspaceClient({ projectId }: { projectId: string }) {
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [deletingDatasetId, setDeletingDatasetId] = useState<string | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [maxConfidence, setMaxConfidence] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [assetsResponse, datasetsResponse] = await Promise.all([
        fetch(`/api/v2/projects/${projectId}/assets?includeLatestAnnotation=true&limit=2500`, {
          cache: "no-store",
        }),
        fetch(`/api/v2/datasets?projectId=${encodeURIComponent(projectId)}`, {
          cache: "no-store",
        }),
      ]);
      const assetsPayload = (await assetsResponse.json().catch(() => ({}))) as {
        assets?: Asset[];
        error?: string;
      };
      const datasetsPayload = (await datasetsResponse.json().catch(() => ({}))) as {
        datasets?: DatasetRecord[];
        error?: string;
      };
      if (!assetsResponse.ok) {
        throw new Error(assetsPayload.error || "Failed to load dataset.");
      }
      if (!datasetsResponse.ok) {
        throw new Error(datasetsPayload.error || "Failed to load dataset list.");
      }

      const filtered = (assetsPayload.assets ?? []).filter(
        (asset) => asset.asset_type === "image" || asset.asset_type === "video_frame",
      );
      setDatasets(datasetsPayload.datasets ?? []);
      setAssets(filtered);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load dataset.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const asset of assets) {
      for (const name of classNames(asset)) {
        set.add(name);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const searchQuery = search.trim().toLowerCase();

    return assets.filter((asset) => {
      if (selectedDatasetId !== "all" && asset.dataset_id !== selectedDatasetId) {
        return false;
      }

      const status = deriveStatus(asset);
      if (statusFilter !== "all" && status !== statusFilter) {
        return false;
      }

      const names = classNames(asset);
      if (classFilter !== "all" && !names.includes(classFilter)) {
        return false;
      }

      const lowestConfidence = deriveLowestConfidence(asset);
      const score = lowestConfidence == null ? 1 : lowestConfidence;
      if (score > maxConfidence) {
        return false;
      }

      if (!searchQuery) {
        return true;
      }

      const idMatch = asset.id.toLowerCase().includes(searchQuery);
      const classMatch = names.some((name) => name.toLowerCase().includes(searchQuery));
      return idMatch || classMatch;
    });
  }, [assets, classFilter, maxConfidence, search, selectedDatasetId, statusFilter]);

  const displayItems = useMemo(() => buildDisplayItems(filteredAssets), [filteredAssets]);

  const datasetAssetCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of assets) {
      counts.set(asset.dataset_id, (counts.get(asset.dataset_id) ?? 0) + 1);
    }
    return counts;
  }, [assets]);

  const totals = useMemo(() => {
    const classSet = new Set<string>();
    let boxCount = 0;
    const allItems = buildDisplayItems(assets);
    let videoCount = 0;
    let imageCount = 0;

    for (const item of allItems) {
      if (item.kind === "video") {
        videoCount += 1;
      } else {
        imageCount += 1;
      }
    }
    for (const asset of assets) {
      for (const shape of asset.latest_annotation?.shapes ?? []) {
        boxCount += 1;
        if (shape.label.trim()) {
          classSet.add(shape.label.trim());
        }
      }
    }
    return {
      items: allItems.length,
      images: imageCount,
      videos: videoCount,
      boxes: boxCount,
      classes: classSet.size,
    };
  }, [assets]);

  async function runAutoLabel(item: DisplayItem) {
    setBusyItemId(item.id);
    setMessage(null);
    setError(null);

    try {
      let processed = 0;
      for (const asset of item.assets) {
        const response = await fetch(`/api/v2/assets/${asset.id}/auto-label`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reasoningEffort }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Auto-label failed.");
        }
        processed += 1;
      }

      await loadData();
      setMessage(`Auto-label complete for ${processed} ${processed === 1 ? "asset" : "assets"}.`);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Auto-label failed.");
    } finally {
      setBusyItemId(null);
    }
  }

  async function markReviewed(item: DisplayItem) {
    const reviewableAssets = item.assets.filter(
      (asset) => Boolean(asset.latest_annotation && asset.latest_annotation.shapes.length > 0),
    );
    if (reviewableAssets.length === 0) {
      return;
    }

    setBusyItemId(item.id);
    setMessage(null);
    setError(null);

    try {
      for (const asset of reviewableAssets) {
        const response = await fetch(`/api/v2/assets/${asset.id}/annotations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: "manual",
            notes: "Marked reviewed in local studio.",
            shapes: asset.latest_annotation?.shapes.map((shape) => ({
              label: shape.label,
              confidence: shape.confidence,
              geometry: shape.geometry,
            })),
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Unable to mark as reviewed.");
        }
      }

      await loadData();
      setMessage(`Marked reviewed for ${reviewableAssets.length} ${reviewableAssets.length === 1 ? "asset" : "assets"}.`);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Unable to mark reviewed.");
    } finally {
      setBusyItemId(null);
    }
  }

  async function deleteDatasetById(datasetId: string) {
    const dataset = datasets.find((item) => item.id === datasetId);
    if (!dataset) {
      setError("Dataset not found.");
      return;
    }

    const confirmed = window.confirm(
      `Delete dataset "${dataset.name}" and all its assets?`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingDatasetId(dataset.id);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/v2/datasets/${dataset.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok && response.status !== 204) {
        throw new Error(payload.error || "Unable to delete dataset.");
      }

      setSelectedDatasetId("all");
      await loadData();
      setMessage(`Deleted dataset "${dataset.name}".`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete dataset.");
    } finally {
      setDeletingDatasetId(null);
    }
  }

  async function deleteSelectedDataset() {
    if (selectedDatasetId === "all") {
      setError("Select a dataset to delete.");
      return;
    }
    await deleteDatasetById(selectedDatasetId);
  }

  async function deleteItem(item: DisplayItem) {
    const label =
      item.kind === "video"
        ? `Delete this video item and its ${item.assets.length} extracted frame assets?`
        : "Delete this image item?";
    const confirmed = window.confirm(label);
    if (!confirmed) {
      return;
    }

    setDeletingItemId(item.id);
    setMessage(null);
    setError(null);
    try {
      for (const asset of item.assets) {
        const response = await fetch(`/api/v2/assets/${asset.id}`, { method: "DELETE" });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok && response.status !== 204) {
          throw new Error(payload.error || "Unable to delete item.");
        }
      }
      await loadData();
      setMessage(
        item.kind === "video"
          ? `Deleted video item (${item.assets.length} frames).`
          : "Deleted image item.",
      );
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete item.");
    } finally {
      setDeletingItemId(null);
    }
  }

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Dataset</h2>
        <p className="text-sm text-muted-foreground">
          {totals.items} items ({totals.images} images, {totals.videos} videos) • {totals.boxes} boxes • {totals.classes} classes
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search asset id or class..."
            />
            <NativeSelect
              value={selectedDatasetId}
              onChange={(event) => setSelectedDatasetId(event.target.value)}
            >
              <option value="all">All datasets</option>
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FilterStatus)}>
              <option value="all">All statuses</option>
              <option value="unlabeled">Unlabeled</option>
              <option value="auto_labeled">Auto-labeled</option>
              <option value="reviewed">Reviewed</option>
            </NativeSelect>
            <NativeSelect value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
              <option value="all">All classes</option>
              {classes.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_auto_auto]">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Show confidence &lt; {maxConfidence.toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={maxConfidence}
                onChange={(event) => setMaxConfidence(Number(event.target.value))}
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Reasoning</span>
              <NativeSelect
                value={reasoningEffort}
                onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </NativeSelect>
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={selectedDatasetId === "all" || deletingDatasetId !== null}
              onClick={() => void deleteSelectedDataset()}
            >
              {deletingDatasetId ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {deletingDatasetId ? "Deleting..." : "Delete dataset"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStatusFilter("all");
                setClassFilter("all");
                setSearch("");
                setMaxConfidence(1);
              }}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {datasets.length > 0 ? (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">Datasets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0">
            {datasets.map((dataset) => {
              const deleting = deletingDatasetId === dataset.id;
              return (
                <div key={dataset.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{dataset.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {datasetAssetCounts.get(dataset.id) ?? 0} assets
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={deleting || deletingDatasetId !== null}
                    onClick={() => void deleteDatasetById(dataset.id)}
                  >
                    {deleting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
                    {deleting ? "Deleting..." : "Delete"}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading dataset...</p> : null}

      {!loading && displayItems.length === 0 ? (
        <Card className="border border-dashed border-border">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No items match these filters.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {displayItems.map((item) => {
          const asset = item.primaryAsset;
          const status = item.status;
          const labels = item.labels;
          const lowest = item.lowestConfidence;
          const shapeCount = item.shapeCount;
          const isBusy = busyItemId === item.id;
          const isDeleting = deletingItemId === item.id;
          const title =
            item.kind === "video" && asset.artifact_id
              ? `video:${asset.artifact_id.slice(0, 8)}`
              : asset.id.slice(0, 10);

          return (
            <Card key={item.id} className="overflow-hidden border border-border/70">
              <CardHeader className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate text-sm">{title}</CardTitle>
                  <Badge variant={status === "reviewed" ? "secondary" : status === "auto_labeled" ? "outline" : "destructive"}>
                    {status === "auto_labeled" ? "auto" : status}
                  </Badge>
                </div>
                {item.kind === "video" ? (
                  <p className="text-xs text-muted-foreground">{item.assets.length} extracted frames (grouped)</p>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3 p-3 pt-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={assetPreviewUrl(asset)}
                  alt={title}
                  className="h-44 w-full rounded-lg border border-border/60 object-cover"
                  loading="lazy"
                />

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{shapeCount} boxes</span>
                  <span>low {confidenceLabel(lowest)}</span>
                </div>

                <div className="flex min-h-6 flex-wrap gap-1">
                  {labels.slice(0, 3).map((name) => (
                    <Badge key={`${asset.id}-${name}`} variant="outline">
                      {name}
                    </Badge>
                  ))}
                  {labels.length > 3 ? <Badge variant="outline">+{labels.length - 3}</Badge> : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={isBusy || isDeleting} onClick={() => void runAutoLabel(item)}>
                    {isBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
                    {item.kind === "video" ? "Auto-label clip" : "Auto-label"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy || isDeleting || status === "reviewed" || shapeCount === 0}
                    onClick={() => void markReviewed(item)}
                  >
                    {status === "reviewed" ? (
                      <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                    ) : (
                      <XCircle className="mr-2 h-3.5 w-3.5" />
                    )}
                    Mark reviewed
                  </Button>
                  <Button asChild size="sm">
                    <Link href={`/projects/${projectId}/annotate?assetId=${asset.id}`}>Open</Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy || isDeleting || deletingItemId !== null}
                    onClick={() => void deleteItem(item)}
                  >
                    {isDeleting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
