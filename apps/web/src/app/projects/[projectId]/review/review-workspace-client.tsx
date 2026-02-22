"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";

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
  asset_type: "image" | "video_frame" | "pdf_page";
  latest_annotation: {
    id: string;
    source: "manual" | "ai_prelabel" | "imported";
    shapes: AnnotationShape[];
  } | null;
};

function previewUrl(assetId: string) {
  return `/api/v2/assets/${assetId}/file`;
}

function riskSummary(asset: Asset) {
  const shapes = asset.latest_annotation?.shapes ?? [];
  if (shapes.length === 0) {
    return {
      score: 1000,
      label: "No annotations yet",
      lowConfidenceCount: 0,
      totalShapes: 0,
    };
  }

  let lowConfidenceCount = 0;
  let minConfidence = 1;
  for (const shape of shapes) {
    const confidence = shape.confidence ?? 0;
    minConfidence = Math.min(minConfidence, confidence);
    if (confidence < 0.35) {
      lowConfidenceCount += 1;
    }
  }

  const score = lowConfidenceCount * 100 + Math.round((1 - minConfidence) * 100);
  const label =
    lowConfidenceCount > 0
      ? `${lowConfidenceCount} low-confidence box${lowConfidenceCount === 1 ? "" : "es"}`
      : "Needs final review";

  return {
    score,
    label,
    lowConfidenceCount,
    totalShapes: shapes.length,
  };
}

export function ReviewWorkspaceClient({ projectId }: { projectId: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
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
        throw new Error(payload.error || "Failed to load review queue.");
      }

      setAssets(
        (payload.assets ?? []).filter(
          (asset) => asset.asset_type === "image" || asset.asset_type === "video_frame",
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load review queue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const queue = useMemo(() => {
    return assets
      .map((asset) => ({ asset, risk: riskSummary(asset) }))
      .sort((left, right) => right.risk.score - left.risk.score);
  }, [assets]);

  async function markReviewed(asset: Asset) {
    const shapes = asset.latest_annotation?.shapes ?? [];
    if (shapes.length === 0) {
      return;
    }

    setBusyAssetId(asset.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/v2/assets/${asset.id}/annotations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "manual",
          notes: "Marked reviewed in queue.",
          shapes: shapes.map((shape) => ({
            label: shape.label,
            confidence: shape.confidence,
            geometry: shape.geometry,
          })),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to mark reviewed.");
      }

      await load();
      setMessage("Review decision saved.");
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Unable to mark reviewed.");
    } finally {
      setBusyAssetId(null);
    }
  }

  async function deleteFromQueue(asset: Asset) {
    const confirmed = window.confirm("Delete this image from the queue?");
    if (!confirmed) {
      return;
    }

    setDeletingAssetId(asset.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/v2/assets/${asset.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok && response.status !== 204) {
        throw new Error(payload.error || "Unable to delete image.");
      }

      await load();
      setMessage("Image deleted from queue.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete image.");
    } finally {
      setDeletingAssetId(null);
    }
  }

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Review Queue</h2>
        <p className="text-sm text-muted-foreground">Prioritized by missing labels and lowest confidence detections.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue ({queue.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading queue...</p> : null}
          {!loading && queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assets available for review.</p>
          ) : null}

          {queue.map(({ asset, risk }) => {
            const isBusy = busyAssetId === asset.id;
            const isDeleting = deletingAssetId === asset.id;
            const status =
              !asset.latest_annotation || asset.latest_annotation.shapes.length === 0
                ? "unlabeled"
                : asset.latest_annotation.source === "ai_prelabel"
                  ? "auto-labeled"
                  : "reviewed";

            return (
              <div
                key={asset.id}
                className="grid gap-3 rounded-xl border border-border/70 p-3 sm:grid-cols-[120px_minmax(0,1fr)_auto]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl(asset.id)}
                  alt={asset.id}
                  className="h-24 w-full rounded-lg border border-border/60 object-cover"
                  loading="lazy"
                />

                <div className="space-y-1">
                  <p className="text-sm font-medium">{asset.id}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{status}</Badge>
                    <Badge variant={risk.score > 200 ? "destructive" : "secondary"}>{risk.label}</Badge>
                    <Badge variant="outline">{risk.totalShapes} boxes</Badge>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button asChild size="sm">
                    <Link href={`/projects/${projectId}/annotate?assetId=${asset.id}`}>Open</Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy || isDeleting || risk.totalShapes === 0}
                    onClick={() => void markReviewed(asset)}
                  >
                    {isBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                    Mark reviewed
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy || isDeleting}
                    onClick={() => void deleteFromQueue(asset)}
                  >
                    {isDeleting ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                    )}
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
