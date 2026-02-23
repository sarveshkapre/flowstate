"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
  artifact_id: string | null;
  asset_type: "image" | "video_frame" | "pdf_page";
  frame_index: number | null;
  latest_annotation: {
    id: string;
    source: "manual" | "ai_prelabel" | "imported";
    shapes: AnnotationShape[];
  } | null;
};

type UploadJob = {
  id: string;
  source_artifact_ids: string[];
  annotated_video_artifact_id: string | null;
  batch_name: string;
  status: "queued" | "processing" | "completed" | "failed";
  stage: string;
  progress: number | null;
  message: string | null;
  created_at: string;
};

function assetPreviewUrl(asset: Asset) {
  return `/api/v2/assets/${asset.id}/file`;
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export function ClipViewerClient({
  projectId,
  artifactId,
}: {
  projectId: string;
  artifactId: string;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [assetsResponse, jobsResponse] = await Promise.all([
          fetch(
            `/api/v2/projects/${projectId}/assets?includeLatestAnnotation=true&limit=2500`,
            { cache: "no-store" },
          ),
          fetch(`/api/v2/projects/${projectId}/upload-jobs?limit=100`, {
            cache: "no-store",
          }),
        ]);

        const assetsPayload = (await assetsResponse.json().catch(() => ({}))) as {
          assets?: Asset[];
          error?: string;
        };
        const jobsPayload = (await jobsResponse.json().catch(() => ({}))) as {
          jobs?: UploadJob[];
          error?: string;
        };

        if (!assetsResponse.ok) {
          throw new Error(assetsPayload.error || "Failed to load clip assets.");
        }
        if (!jobsResponse.ok) {
          throw new Error(jobsPayload.error || "Failed to load clip jobs.");
        }

        setAssets(assetsPayload.assets ?? []);
        setJobs(jobsPayload.jobs ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load clip.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [projectId]);

  const clipAssets = useMemo(() => {
    return assets
      .filter(
        (asset) =>
          asset.asset_type === "video_frame" && asset.artifact_id === artifactId,
      )
      .sort((left, right) => {
        const leftFrame = left.frame_index ?? Number.MAX_SAFE_INTEGER;
        const rightFrame = right.frame_index ?? Number.MAX_SAFE_INTEGER;
        if (leftFrame !== rightFrame) {
          return leftFrame - rightFrame;
        }
        return left.id.localeCompare(right.id);
      });
  }, [artifactId, assets]);

  const relatedJobs = useMemo(() => {
    return jobs
      .filter((job) => job.source_artifact_ids.includes(artifactId))
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }, [artifactId, jobs]);

  const bestJob = useMemo(() => {
    const withVideo = relatedJobs.find((job) => Boolean(job.annotated_video_artifact_id));
    return withVideo ?? relatedJobs[0] ?? null;
  }, [relatedJobs]);

  const annotatedVideoUrl = bestJob?.annotated_video_artifact_id
    ? `/api/v1/uploads/${bestJob.annotated_video_artifact_id}/file`
    : null;

  const summary = useMemo(() => {
    let boxCount = 0;
    let labeledFrames = 0;
    const classes = new Set<string>();
    for (const asset of clipAssets) {
      const shapes = asset.latest_annotation?.shapes ?? [];
      if (shapes.length > 0) {
        labeledFrames += 1;
      }
      for (const shape of shapes) {
        boxCount += 1;
        if (shape.label.trim()) {
          classes.add(shape.label.trim());
        }
      }
    }
    return {
      frameCount: clipAssets.length,
      labeledFrames,
      boxCount,
      classes: [...classes].sort((a, b) => a.localeCompare(b)),
    };
  }, [clipAssets]);

  const firstFrame = clipAssets[0] ?? null;

  return (
    <section className="mx-auto w-full max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Clip Viewer</h1>
          <p className="text-sm text-muted-foreground">
            Artifact {artifactId.slice(0, 12)} • {summary.frameCount} frames • {summary.boxCount} boxes
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href={`/projects/${projectId}/dataset`}>Back to Dataset</Link>
          </Button>
          {firstFrame ? (
            <Button asChild variant="outline">
              <Link href={`/projects/${projectId}/annotate?assetId=${firstFrame.id}`}>
                Open first frame
              </Link>
            </Button>
          ) : null}
          {annotatedVideoUrl ? (
            <Button asChild>
              <a href={annotatedVideoUrl} download>
                Download Annotated MP4
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{summary.labeledFrames} labeled frames</Badge>
        <Badge variant="outline">{summary.classes.length} classes</Badge>
        {bestJob ? (
          <Badge variant="secondary">
            {bestJob.status} • {bestJob.stage}
          </Badge>
        ) : (
          <Badge variant="outline">No matching upload job</Badge>
        )}
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading clip...</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!loading && !error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Annotated Clip</CardTitle>
          </CardHeader>
          <CardContent>
            {annotatedVideoUrl ? (
              <video
                src={annotatedVideoUrl}
                controls
                className="w-full rounded-lg border border-border/70 bg-black"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Annotated MP4 is not available yet for this clip. You can still inspect extracted frames below.
              </p>
            )}
            {bestJob ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Latest related job: {bestJob.batch_name} • {formatDateTime(bestJob.created_at)}
                {bestJob.message ? ` • ${bestJob.message}` : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!loading && !error && clipAssets.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Frames</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {clipAssets.slice(0, 24).map((asset) => {
              const boxCount = asset.latest_annotation?.shapes.length ?? 0;
              return (
                <Link
                  key={asset.id}
                  href={`/projects/${projectId}/annotate?assetId=${asset.id}`}
                  className="space-y-2 rounded-lg border border-border/70 p-2 transition-colors hover:bg-muted/40"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={assetPreviewUrl(asset)}
                    alt={asset.id}
                    className="h-32 w-full rounded-md object-cover"
                    loading="lazy"
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>frame {asset.frame_index ?? "-"}</span>
                    <span>{boxCount} boxes</span>
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
