"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";
import { Input } from "@shadcn-ui/input";
import { Tabs, TabsList, TabsTrigger } from "@shadcn-ui/tabs";
import { Textarea } from "@shadcn-ui/textarea";

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
  geometry:
    | {
        type: "bbox";
        x: number;
        y: number;
        width: number;
        height: number;
      }
    | {
        type: "polygon";
        points: Array<{ x: number; y: number }>;
      };
};

type AnnotationRecord = {
  id: string;
  source: "manual" | "ai_prelabel" | "imported";
  shapes: AnnotationShape[];
  updated_at: string;
};

type LabelDraft = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const EMPTY_DRAFT: LabelDraft = {
  label: "",
  x: 0.1,
  y: 0.1,
  width: 0.3,
  height: 0.3,
};

type FilterMode = "all" | "labeled" | "unlabeled";
type DrawState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function toBbox(drawState: DrawState) {
  const x = Math.min(drawState.startX, drawState.currentX);
  const y = Math.min(drawState.startY, drawState.currentY);
  const width = Math.abs(drawState.currentX - drawState.startX);
  const height = Math.abs(drawState.currentY - drawState.startY);

  return { x, y, width, height };
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

export function AnnotateWorkspaceClient({ projectId }: { projectId: string }) {
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [labelDraft, setLabelDraft] = useState<LabelDraft>(EMPTY_DRAFT);
  const [draftShapes, setDraftShapes] = useState<AnnotationShape[]>([]);
  const [autoLabelPrompt, setAutoLabelPrompt] = useState("");
  const [labelHints, setLabelHints] = useState("");
  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadAssets() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/v2/projects/${projectId}/assets?includeLatestAnnotation=true&limit=800`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as { assets?: Asset[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load assets.");
      }

      const nextAssets = payload.assets ?? [];
      setAssets(nextAssets);
      const firstAsset = nextAssets[0];
      if (firstAsset && !nextAssets.some((asset) => asset.id === selectedAssetId)) {
        setSelectedAssetId(firstAsset.id);
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

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      if (filterMode === "all") {
        return true;
      }
      if (filterMode === "labeled") {
        return Boolean(asset.latest_annotation);
      }
      return !asset.latest_annotation;
    });
  }, [assets, filterMode]);

  const selectedAsset = useMemo(
    () => filteredAssets.find((asset) => asset.id === selectedAssetId) ?? filteredAssets[0] ?? null,
    [filteredAssets, selectedAssetId],
  );

  useEffect(() => {
    if (!selectedAsset) {
      setDraftShapes([]);
      setDrawState(null);
      return;
    }

    const prefill = selectedAsset.latest_annotation?.shapes.filter((shape) => shape.geometry.type === "bbox") ?? [];
    setDraftShapes(prefill);
    setDrawState(null);
  }, [selectedAsset]);

  function addDraftShape() {
    if (!labelDraft.label.trim()) {
      setError("Label is required.");
      return;
    }

    const next: AnnotationShape = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label: labelDraft.label.trim(),
      confidence: null,
      geometry: {
        type: "bbox",
        x: Math.max(0, Math.min(1, labelDraft.x)),
        y: Math.max(0, Math.min(1, labelDraft.y)),
        width: Math.max(0, Math.min(1, labelDraft.width)),
        height: Math.max(0, Math.min(1, labelDraft.height)),
      },
    };

    setDraftShapes((current) => [...current, next]);
    setLabelDraft((current) => ({ ...current, label: "" }));
    setError(null);
  }

  async function saveManualAnnotation() {
    if (!selectedAsset) {
      return;
    }

    if (draftShapes.length === 0) {
      setError("Add at least one shape before saving.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/v2/assets/${selectedAsset.id}/annotations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "manual",
          shapes: draftShapes.map((shape) => ({
            id: shape.id,
            label: shape.label,
            confidence: shape.confidence,
            geometry: shape.geometry,
          })),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save annotation.");
      }

      setMessage("Annotation saved.");
      await loadAssets();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save annotation.");
    } finally {
      setBusy(false);
    }
  }

  async function runAutoLabel() {
    if (!selectedAsset) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/v2/assets/${selectedAsset.id}/auto-label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: autoLabelPrompt.trim() || undefined,
          labelHints: labelHints
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        annotation?: AnnotationRecord;
        error?: string;
      };
      if (!response.ok || !payload.annotation) {
        throw new Error(payload.error || "Auto-label failed.");
      }

      setDraftShapes(payload.annotation.shapes.filter((shape) => shape.geometry.type === "bbox"));
      setMessage(`Auto-label added ${payload.annotation.shapes.length} shape(s).`);
      await loadAssets();
    } catch (autoError) {
      setError(autoError instanceof Error ? autoError.message : "Auto-label failed.");
    } finally {
      setBusy(false);
    }
  }

  const previewUrl = assetPreviewUrl(selectedAsset);
  const inProgressBbox = drawState ? toBbox(drawState) : null;
  const canDrawOnSelectedAsset = selectedAsset?.asset_type === "image" || selectedAsset?.asset_type === "video_frame";
  const rawAssetUrl =
    selectedAsset?.storage_path?.trim() ||
    (selectedAsset?.artifact_id ? `/api/v1/uploads/${selectedAsset.artifact_id}/file` : null);

  function getPointerNormalizedPosition(event: React.PointerEvent<HTMLDivElement>) {
    const frame = previewFrameRef.current;
    if (!frame) {
      return { x: 0, y: 0 };
    }

    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0 };
    }

    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }

  function onDrawStart(event: React.PointerEvent<HTMLDivElement>) {
    if (!selectedAsset || !canDrawOnSelectedAsset || event.button !== 0) {
      return;
    }

    const pointer = getPointerNormalizedPosition(event);
    setDrawState({
      startX: pointer.x,
      startY: pointer.y,
      currentX: pointer.x,
      currentY: pointer.y,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDrawMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drawState || !selectedAsset || !canDrawOnSelectedAsset) {
      return;
    }

    const pointer = getPointerNormalizedPosition(event);
    setDrawState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        currentX: pointer.x,
        currentY: pointer.y,
      };
    });
  }

  function onDrawEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (!drawState || !selectedAsset || !canDrawOnSelectedAsset) {
      return;
    }

    const pointer = getPointerNormalizedPosition(event);
    const finalized = toBbox({
      ...drawState,
      currentX: pointer.x,
      currentY: pointer.y,
    });
    setDrawState(null);

    if (finalized.width < 0.01 || finalized.height < 0.01) {
      return;
    }

    const label = labelDraft.label.trim() || "object";
    const next: AnnotationShape = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label,
      confidence: null,
      geometry: {
        type: "bbox",
        x: finalized.x,
        y: finalized.y,
        width: finalized.width,
        height: finalized.height,
      },
    };

    setDraftShapes((current) => [...current, next]);
    setError(null);
    setMessage("Box added from draw tool.");
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Annotate</h1>
          <p className="text-sm text-muted-foreground">Label assets with manual boxes or OpenAI auto-label.</p>
        </div>
        <Badge variant="outline">{filteredAssets.length} assets</Badge>
      </div>

      <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader className="space-y-3">
            <CardTitle className="text-base">Queue</CardTitle>
            <Tabs value={filterMode} onValueChange={(value) => setFilterMode(value as FilterMode)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="unlabeled">Open</TabsTrigger>
                <TabsTrigger value="labeled">Done</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
            {!loading && filteredAssets.length === 0 ? <p className="text-sm text-muted-foreground">No assets.</p> : null}
            {filteredAssets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => setSelectedAssetId(asset.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  selectedAsset?.id === asset.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                }`}
              >
                <p className="truncate text-sm font-medium">{asset.asset_type.replace("_", " ")}</p>
                <p className="text-xs text-muted-foreground">
                  {asset.frame_index ? `frame ${asset.frame_index}` : asset.page_number ? `page ${asset.page_number}` : asset.id.slice(0, 8)}
                </p>
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
                  previewUrl ? (
                    selectedAsset.asset_type === "image" || selectedAsset.asset_type === "video_frame" ? (
                      <div className="mx-auto w-fit">
                        <div
                          ref={previewFrameRef}
                          className="relative inline-block select-none touch-none"
                          onPointerDown={onDrawStart}
                          onPointerMove={onDrawMove}
                          onPointerUp={onDrawEnd}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={previewUrl}
                            alt="Asset preview"
                            className="max-h-[520px] rounded-lg object-contain"
                            draggable={false}
                          />
                          <div className="pointer-events-none absolute inset-0">
                            {draftShapes.map((shape) =>
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
                            {inProgressBbox ? (
                              <div
                                className="absolute border-2 border-dashed border-primary"
                                style={{
                                  left: `${inProgressBbox.x * 100}%`,
                                  top: `${inProgressBbox.y * 100}%`,
                                  width: `${inProgressBbox.width * 100}%`,
                                  height: `${inProgressBbox.height * 100}%`,
                                }}
                              />
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : selectedAsset.asset_type === "pdf_page" ? (
                      <iframe title="PDF preview" src={previewUrl} className="h-[520px] w-full rounded-lg border border-border bg-background" />
                    ) : (
                      <video src={previewUrl} controls className="max-h-[520px] w-full rounded-lg object-contain" />
                    )
                  ) : (
                    <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                      Preview unavailable
                    </div>
                  )
                ) : (
                  <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                    Select an asset
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void saveManualAnnotation()} disabled={busy || !selectedAsset}>
                  Save Annotation
                </Button>
                <Button variant="outline" onClick={() => setDraftShapes([])} disabled={busy}>
                  Clear Draft
                </Button>
                {rawAssetUrl ? (
                  <Button variant="ghost" asChild>
                    <a href={rawAssetUrl} target="_blank" rel="noreferrer">
                      Open Raw
                    </a>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Manual Label</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  placeholder="Label"
                  value={labelDraft.label}
                  onChange={(event) => setLabelDraft((current) => ({ ...current, label: event.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Tip: click and drag directly on image preview to add a box.</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={labelDraft.x}
                    onChange={(event) => setLabelDraft((current) => ({ ...current, x: Number(event.target.value) }))}
                    placeholder="x"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={labelDraft.y}
                    onChange={(event) => setLabelDraft((current) => ({ ...current, y: Number(event.target.value) }))}
                    placeholder="y"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={labelDraft.width}
                    onChange={(event) => setLabelDraft((current) => ({ ...current, width: Number(event.target.value) }))}
                    placeholder="width"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={labelDraft.height}
                    onChange={(event) => setLabelDraft((current) => ({ ...current, height: Number(event.target.value) }))}
                    placeholder="height"
                  />
                </div>
                <Button variant="outline" onClick={addDraftShape} disabled={busy}>
                  Add Box
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Auto Label (OpenAI)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  placeholder="Label hints (person, car, pallet)"
                  value={labelHints}
                  onChange={(event) => setLabelHints(event.target.value)}
                />
                <Textarea
                  value={autoLabelPrompt}
                  onChange={(event) => setAutoLabelPrompt(event.target.value)}
                  placeholder="Instruction (optional)"
                  className="min-h-24"
                />
                <Button variant="outline" onClick={() => void runAutoLabel()} disabled={busy || !selectedAsset}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Run Auto Label
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Draft Shapes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {draftShapes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No shapes yet. Draw on image or add a numeric box.</p>
              ) : null}
              {draftShapes.map((shape) => (
                <div key={shape.id} className="flex items-center justify-between rounded-lg border border-border p-2">
                  <div>
                    <p className="text-sm font-medium">{shape.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {shape.geometry.type === "bbox"
                        ? `x:${shape.geometry.x.toFixed(2)} y:${shape.geometry.y.toFixed(2)} w:${shape.geometry.width.toFixed(2)} h:${shape.geometry.height.toFixed(2)}`
                        : `${shape.geometry.points.length} points`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraftShapes((current) => current.filter((item) => item.id !== shape.id))}
                  >
                    Remove
                  </Button>
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
