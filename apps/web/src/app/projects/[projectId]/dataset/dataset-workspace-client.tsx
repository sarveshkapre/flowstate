"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Sparkles, XCircle } from "lucide-react";

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

type FilterStatus = "all" | "unlabeled" | "auto_labeled" | "reviewed";

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

function confidenceLabel(value: number | null) {
  if (value == null) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

export function DatasetWorkspaceClient({ projectId }: { projectId: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [maxConfidence, setMaxConfidence] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadAssets() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v2/projects/${projectId}/assets?includeLatestAnnotation=true&limit=2500`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        assets?: Asset[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load dataset.");
      }

      const filtered = (payload.assets ?? []).filter(
        (asset) => asset.asset_type === "image" || asset.asset_type === "video_frame",
      );
      setAssets(filtered);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load dataset.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAssets();
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
  }, [assets, classFilter, maxConfidence, search, statusFilter]);

  const totals = useMemo(() => {
    const classSet = new Set<string>();
    let boxCount = 0;
    for (const asset of assets) {
      for (const shape of asset.latest_annotation?.shapes ?? []) {
        boxCount += 1;
        if (shape.label.trim()) {
          classSet.add(shape.label.trim());
        }
      }
    }
    return {
      images: assets.length,
      boxes: boxCount,
      classes: classSet.size,
    };
  }, [assets]);

  async function runAutoLabel(assetId: string) {
    setBusyAssetId(assetId);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/v2/assets/${assetId}/auto-label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Auto-label failed.");
      }

      await loadAssets();
      setMessage("Auto-label complete.");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Auto-label failed.");
    } finally {
      setBusyAssetId(null);
    }
  }

  async function markReviewed(asset: Asset) {
    if (!asset.latest_annotation || asset.latest_annotation.shapes.length === 0) {
      return;
    }

    setBusyAssetId(asset.id);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/v2/assets/${asset.id}/annotations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "manual",
          notes: "Marked reviewed in local studio.",
          shapes: asset.latest_annotation.shapes.map((shape) => ({
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

      await loadAssets();
      setMessage("Marked reviewed.");
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Unable to mark reviewed.");
    } finally {
      setBusyAssetId(null);
    }
  }

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Dataset</h2>
        <p className="text-sm text-muted-foreground">
          {totals.images} images • {totals.boxes} boxes • {totals.classes} classes
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search asset id or class..."
          />
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
        </CardContent>
      </Card>

      {loading ? <p className="text-sm text-muted-foreground">Loading dataset...</p> : null}

      {!loading && filteredAssets.length === 0 ? (
        <Card className="border border-dashed border-border">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No images match these filters.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {filteredAssets.map((asset) => {
          const status = deriveStatus(asset);
          const labels = classNames(asset);
          const lowest = deriveLowestConfidence(asset);
          const shapeCount = asset.latest_annotation?.shapes.length ?? 0;
          const isBusy = busyAssetId === asset.id;

          return (
            <Card key={asset.id} className="overflow-hidden border border-border/70">
              <CardHeader className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate text-sm">{asset.id.slice(0, 10)}</CardTitle>
                  <Badge
                    variant={
                      status === "reviewed" ? "secondary" : status === "auto_labeled" ? "outline" : "destructive"
                    }
                  >
                    {status === "auto_labeled" ? "auto" : status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-3 pt-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={assetPreviewUrl(asset)}
                  alt={asset.id}
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
                  <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={() => void runAutoLabel(asset.id)}>
                    {isBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
                    Auto-label
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy || status === "reviewed" || shapeCount === 0}
                    onClick={() => void markReviewed(asset)}
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
