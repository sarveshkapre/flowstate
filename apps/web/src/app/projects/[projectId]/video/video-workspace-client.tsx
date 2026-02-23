"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Download, Loader2, PlayCircle } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";
import { Input } from "@shadcn-ui/input";
import { NativeSelect } from "@shadcn-ui/native-select";
import { Switch } from "@shadcn-ui/switch";

type VideoRunStatus = "processing" | "done" | "failed";
type VideoRunStage =
  | "queued"
  | "extracting_frames"
  | "detecting_keyframes"
  | "tracking"
  | "rendering"
  | "completed"
  | "failed";
type VideoRunMode = "track_only" | "track_speed";
type VideoQualityMode = "fast" | "balanced" | "quality";
type ReasoningEffort = "low" | "medium" | "high";
type VideoSpeedMode = "relative" | "calibrated";
const MAX_VIDEO_CLIP_SECONDS = 2;

type RunSummary = {
  run_id: string;
  created_at: string;
  updated_at: string;
  status: VideoRunStatus;
  stage: VideoRunStage;
  stage_progress: number | null;
  error: string | null;
  summary: {
    targets: string[];
    mode: VideoRunMode;
    quality_mode: VideoQualityMode;
    speed_mode: VideoSpeedMode;
    duration_s: number | null;
    frame_count: number | null;
  } | null;
};

type RunDetail = {
  run: {
    run_id: string;
    status: VideoRunStatus;
    stage: VideoRunStage;
    stage_progress: number | null;
    error: string | null;
    created_at: string;
    updated_at: string;
    processing: {
      fps_work: number;
      frame_count: number;
      inference_stride_frames: number;
      confidence_threshold: number;
      trim: { start_s: number; end_s: number };
    };
    openai: {
      model: string;
      reasoning_effort: ReasoningEffort;
      requests: { num_images_sent: number };
    };
    summary: RunSummary["summary"];
  };
};

type TracksFile = {
  classes: Array<{ class_id: number; name: string }>;
  tracks: Array<{
    track_id: number;
    class_id: number;
    label: string;
    frames: Array<{
      frame_index: number;
      t_s: number;
      bbox_xywh: [number, number, number, number];
      velocity: {
        speed_px_per_s: number;
        km_per_h: number | null;
      };
    }>;
  }>;
  frame_index: Array<{
    frame_index: number;
    t_s: number;
    detections: Array<{
      track_id: number;
      class_id: number;
      bbox_xywh: [number, number, number, number];
      confidence: number | null;
    }>;
  }>;
};

type UploadResult = {
  artifact: {
    id: string;
  };
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatStage(stage: VideoRunStage) {
  return stage.replace(/_/g, " ");
}

function qualityDefaults(mode: VideoQualityMode) {
  if (mode === "fast") {
    return { fpsWork: 10, stride: 10, threshold: 0.4 };
  }
  if (mode === "quality") {
    return { fpsWork: 15, stride: 5, threshold: 0.3 };
  }
  return { fpsWork: 12, stride: 6, threshold: 0.35 };
}

function colorForTrack(trackId: number) {
  const palette = ["#00ff88", "#00d2ff", "#ffc400", "#ff6b6b", "#8f7bff", "#6ee7b7", "#f97316"];
  return palette[(trackId - 1) % palette.length] ?? "#00ff88";
}

export function VideoWorkspaceClient({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [selectedRun, setSelectedRun] = useState<RunDetail["run"] | null>(null);
  const [tracks, setTracks] = useState<TracksFile | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [targetPeople, setTargetPeople] = useState(true);
  const [targetCars, setTargetCars] = useState(false);
  const [targetBall, setTargetBall] = useState(false);
  const [customTarget, setCustomTarget] = useState("");
  const [mode, setMode] = useState<VideoRunMode>("track_only");
  const [qualityMode, setQualityMode] = useState<VideoQualityMode>("balanced");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [trimStartS, setTrimStartS] = useState("0");
  const [trimEndS, setTrimEndS] = useState(String(MAX_VIDEO_CLIP_SECONDS));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [fpsWork, setFpsWork] = useState("12");
  const [inferenceStrideFrames, setInferenceStrideFrames] = useState("6");
  const [confidenceThreshold, setConfidenceThreshold] = useState("0.35");
  const [speedEnabled, setSpeedEnabled] = useState(false);
  const [speedMode, setSpeedMode] = useState<VideoSpeedMode>("relative");
  const [metersPerPixel, setMetersPerPixel] = useState("");
  const [trailsEnabled, setTrailsEnabled] = useState(true);
  const [trailFrames, setTrailFrames] = useState("20");

  const [showBoxes, setShowBoxes] = useState(true);
  const [showIds, setShowIds] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [showSpeed, setShowSpeed] = useState(false);

  const viewerVideoRef = useRef<HTMLVideoElement | null>(null);
  const viewerCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const currentDefaults = useMemo(() => qualityDefaults(qualityMode), [qualityMode]);
  const estimatedCalls = useMemo(() => {
    const trimStart = Number(trimStartS);
    const trimEnd = Number(trimEndS);
    const fps = advancedOpen ? Number(fpsWork) : currentDefaults.fpsWork;
    const stride = advancedOpen ? Number(inferenceStrideFrames) : currentDefaults.stride;
    if (!Number.isFinite(trimStart) || !Number.isFinite(trimEnd) || !Number.isFinite(fps) || !Number.isFinite(stride)) {
      return 0;
    }
    const duration = Math.min(MAX_VIDEO_CLIP_SECONDS, Math.max(0, trimEnd - trimStart));
    const frameCount = Math.max(0, Math.ceil(duration * fps));
    return Math.max(0, Math.ceil(frameCount / Math.max(1, stride)));
  }, [advancedOpen, currentDefaults.fpsWork, currentDefaults.stride, fpsWork, inferenceStrideFrames, trimEndS, trimStartS]);

  async function loadRuns(selectLatest = false) {
    setLoadingRuns(true);
    try {
      const response = await fetch(`/api/v2/projects/${projectId}/video-runs`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { runs?: RunSummary[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load video runs.");
      }
      const nextRuns = payload.runs ?? [];
      setRuns(nextRuns);
      if (nextRuns.length > 0 && (!selectedRunId || selectLatest)) {
        setSelectedRunId(nextRuns[0]!.run_id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load video runs.");
    } finally {
      setLoadingRuns(false);
    }
  }

  async function loadRunDetail(runId: string) {
    const detailResponse = await fetch(`/api/v2/projects/${projectId}/video-runs/${runId}`, {
      cache: "no-store",
    });
    const detailPayload = (await detailResponse.json().catch(() => ({}))) as RunDetail & { error?: string };
    if (!detailResponse.ok || !detailPayload.run) {
      throw new Error(detailPayload.error || "Unable to load run.");
    }
    setSelectedRun(detailPayload.run);

    if (detailPayload.run.status === "done") {
      const tracksResponse = await fetch(`/api/v2/projects/${projectId}/video-runs/${runId}/tracks`, {
        cache: "no-store",
      });
      const tracksPayload = (await tracksResponse.json().catch(() => null)) as TracksFile | null;
      if (tracksResponse.ok && tracksPayload) {
        setTracks(tracksPayload);
      } else {
        setTracks(null);
      }
    } else {
      setTracks(null);
    }
  }

  useEffect(() => {
    void loadRuns(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null);
      setTracks(null);
      return;
    }

    void loadRunDetail(selectedRunId).catch((detailError) => {
      setError(detailError instanceof Error ? detailError.message : "Unable to load run.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId, projectId]);

  useEffect(() => {
    if (!selectedRun || selectedRun.status !== "processing") {
      return;
    }
    const timer = window.setInterval(() => {
      void loadRuns().then(() => {
        if (selectedRunId) {
          void loadRunDetail(selectedRunId).catch(() => undefined);
        }
      });
    }, 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRun, selectedRunId]);

  useEffect(() => {
    if (!viewerVideoRef.current || !viewerCanvasRef.current || !tracks) {
      return;
    }
    const videoEl = viewerVideoRef.current!;
    const canvasEl = viewerCanvasRef.current!;
    const tracksData = tracks as TracksFile;

    const context2d = canvasEl.getContext("2d");
    if (!context2d) {
      return;
    }
    const context = context2d;

    const labelByTrack = new Map<number, string>();
    for (const track of tracksData.tracks) {
      labelByTrack.set(track.track_id, track.label);
    }

    const frameMap = new Map(tracksData.frame_index.map((entry) => [entry.frame_index, entry]));
    const frameRate = selectedRun?.processing.fps_work ?? 12;
    const trailWindow = Math.max(0, Number(trailFrames) || 20);

    function resizeCanvas() {
      const width = videoEl.videoWidth || 0;
      const height = videoEl.videoHeight || 0;
      if (width <= 0 || height <= 0) {
        return;
      }
      canvasEl.width = width;
      canvasEl.height = height;
      canvasEl.style.width = `${videoEl.clientWidth}px`;
      canvasEl.style.height = `${videoEl.clientHeight}px`;
    }

    function drawFrame() {
      resizeCanvas();
      const width = canvasEl.width;
      const height = canvasEl.height;
      context.clearRect(0, 0, width, height);

      const frameIndex = Math.max(0, Math.floor(videoEl.currentTime * frameRate));
      const entry = frameMap.get(frameIndex);
      if (!entry) {
        return;
      }

      for (const detection of entry.detections) {
        const color = colorForTrack(detection.track_id);
        const [x, y, w, h] = detection.bbox_xywh;

        if (showTrails) {
          for (let previous = Math.max(0, frameIndex - trailWindow); previous < frameIndex; previous += 1) {
            const previousEntry = frameMap.get(previous);
            const previousDetection = previousEntry?.detections.find((item) => item.track_id === detection.track_id);
            if (!previousDetection) {
              continue;
            }
            const centerX = previousDetection.bbox_xywh[0] + previousDetection.bbox_xywh[2] / 2;
            const centerY = previousDetection.bbox_xywh[1] + previousDetection.bbox_xywh[3] / 2;
            context.fillStyle = `${color}99`;
            context.fillRect(centerX - 1.5, centerY - 1.5, 3, 3);
          }
        }

        if (showBoxes) {
          context.strokeStyle = color;
          context.lineWidth = 2;
          context.strokeRect(x, y, w, h);
        }

        if (showIds || showSpeed) {
          const label = labelByTrack.get(detection.track_id) ?? "object";
          const track = tracksData.tracks.find((item) => item.track_id === detection.track_id);
          const trackFrame = track?.frames.find((item) => item.frame_index === frameIndex);
          const speedLabel =
            showSpeed && trackFrame
              ? trackFrame.velocity.km_per_h != null
                ? `${trackFrame.velocity.km_per_h.toFixed(1)}km/h`
                : `${trackFrame.velocity.speed_px_per_s.toFixed(1)}px/s`
              : null;
          const textParts = [];
          if (showIds) {
            textParts.push(`${label} #${detection.track_id}`);
          }
          if (speedLabel) {
            textParts.push(speedLabel);
          }
          const text = textParts.join(" ");
          if (text) {
            context.font = "14px ui-sans-serif";
            const metrics = context.measureText(text);
            const textX = Math.max(0, x);
            const textY = Math.max(16, y - 6);
            context.fillStyle = color;
            context.fillRect(textX - 3, textY - 14, metrics.width + 8, 18);
            context.fillStyle = "#041013";
            context.fillText(text, textX, textY);
          }
        }
      }
    }

    function onTick() {
      drawFrame();
      if (!videoEl.paused && !videoEl.ended) {
        window.requestAnimationFrame(onTick);
      }
    }

    function onPlay() {
      window.requestAnimationFrame(onTick);
    }

    function onPauseOrSeek() {
      drawFrame();
    }

    videoEl.addEventListener("loadedmetadata", resizeCanvas);
    videoEl.addEventListener("play", onPlay);
    videoEl.addEventListener("pause", onPauseOrSeek);
    videoEl.addEventListener("seeked", onPauseOrSeek);
    window.addEventListener("resize", resizeCanvas);
    drawFrame();

    return () => {
      videoEl.removeEventListener("loadedmetadata", resizeCanvas);
      videoEl.removeEventListener("play", onPlay);
      videoEl.removeEventListener("pause", onPauseOrSeek);
      videoEl.removeEventListener("seeked", onPauseOrSeek);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [projectId, selectedRun, showBoxes, showIds, showSpeed, showTrails, trailFrames, tracks]);

  async function onCreateRun() {
    if (!videoFile) {
      setError("Select a video file first.");
      return;
    }

    const targets = [
      targetPeople ? "person" : null,
      targetCars ? "car" : null,
      targetBall ? "ball" : null,
      customTarget.trim() ? customTarget.trim() : null,
    ].filter((value): value is string => Boolean(value));

    if (targets.length === 0) {
      setError("Select at least one target.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    const trimStart = Number(trimStartS);
    const trimEnd = Number(trimEndS);
    const normalizedTrimStart = Number.isFinite(trimStart) && trimStart >= 0 ? trimStart : 0;
    const requestedTrimEnd =
      Number.isFinite(trimEnd) && trimEnd > normalizedTrimStart
        ? trimEnd
        : normalizedTrimStart + MAX_VIDEO_CLIP_SECONDS;
    const normalizedTrimEnd = Math.min(requestedTrimEnd, normalizedTrimStart + MAX_VIDEO_CLIP_SECONDS);

    try {
      const uploadForm = new FormData();
      uploadForm.append("file", videoFile);
      const uploadResponse = await fetch("/api/v1/uploads", {
        method: "POST",
        body: uploadForm,
      });
      const uploadPayload = (await uploadResponse.json().catch(() => ({}))) as UploadResult & { error?: string };
      if (!uploadResponse.ok || !uploadPayload.artifact?.id) {
        throw new Error(uploadPayload.error || "Video upload failed.");
      }

      const runResponse = await fetch(`/api/v2/projects/${projectId}/video-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artifactId: uploadPayload.artifact.id,
          targets,
          mode,
          qualityMode,
          reasoningEffort,
          trimStartS: normalizedTrimStart,
          trimEndS: normalizedTrimEnd,
          speedEnabled,
          speedMode,
          metersPerPixel: metersPerPixel.trim() ? Number(metersPerPixel) : undefined,
          trailsEnabled,
          trailFrames: Number(trailFrames),
          ...(advancedOpen
            ? {
                fpsWork: Number(fpsWork),
                inferenceStrideFrames: Number(inferenceStrideFrames),
                confidenceThreshold: Number(confidenceThreshold),
              }
            : {}),
        }),
      });
      const runPayload = (await runResponse.json().catch(() => ({}))) as {
        run?: { run_id: string };
        error?: string;
      };
      if (!runResponse.ok || !runPayload.run) {
        throw new Error(runPayload.error || "Unable to start video run.");
      }

      setVideoFile(null);
      setMessage(`Video run ${runPayload.run.run_id} started.`);
      await loadRuns(true);
      setSelectedRunId(runPayload.run.run_id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to start run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">Video</h2>
          <p className="text-sm text-muted-foreground">
            Track targets in short videos with OpenAI keyframe detections and local tracking.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{runs.length} runs</Badge>
          <Button onClick={() => void loadRuns(true)} variant="outline" size="sm">
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New Run</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="space-y-1">
                <span className="text-sm font-medium">Import Video</span>
                <Input
                  type="file"
                  accept="video/*"
                  onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                Quick defaults: Track only, Balanced quality, {trimStartS}s to {trimEndS}s
                (max {MAX_VIDEO_CLIP_SECONDS}s clip).
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Targets</p>
                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={targetPeople} onChange={(event) => setTargetPeople(event.target.checked)} />
                    People
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={targetCars} onChange={(event) => setTargetCars(event.target.checked)} />
                    Cars
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={targetBall} onChange={(event) => setTargetBall(event.target.checked)} />
                    Ball
                  </label>
                </div>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Custom class</span>
                  <Input value={customTarget} onChange={(event) => setCustomTarget(event.target.value)} placeholder="e.g. bicycle" />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
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
                <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <span>Advanced controls</span>
                  <Switch checked={advancedOpen} onCheckedChange={setAdvancedOpen} />
                </label>
              </div>

              {advancedOpen ? (
                <div className="space-y-3 rounded-xl border border-border bg-muted/10 p-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Mode</span>
                      <NativeSelect value={mode} onChange={(event) => setMode(event.target.value as VideoRunMode)}>
                        <option value="track_only">Track only</option>
                        <option value="track_speed">Track + Speed</option>
                      </NativeSelect>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Quality</span>
                      <NativeSelect
                        value={qualityMode}
                        onChange={(event) => {
                          const nextMode = event.target.value as VideoQualityMode;
                          setQualityMode(nextMode);
                          const defaults = qualityDefaults(nextMode);
                          setFpsWork(String(defaults.fpsWork));
                          setInferenceStrideFrames(String(defaults.stride));
                          setConfidenceThreshold(String(defaults.threshold));
                        }}
                      >
                        <option value="fast">Fast</option>
                        <option value="balanced">Balanced</option>
                        <option value="quality">Quality</option>
                      </NativeSelect>
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Trim Start (s)</span>
                      <Input value={trimStartS} onChange={(event) => setTrimStartS(event.target.value)} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Trim End (s)</span>
                      <Input value={trimEndS} onChange={(event) => setTrimEndS(event.target.value)} />
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">FPS</span>
                      <Input value={fpsWork} onChange={(event) => setFpsWork(event.target.value)} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Stride</span>
                      <Input value={inferenceStrideFrames} onChange={(event) => setInferenceStrideFrames(event.target.value)} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Confidence</span>
                      <Input value={confidenceThreshold} onChange={(event) => setConfidenceThreshold(event.target.value)} />
                    </label>
                  </div>
                </div>
              ) : null}

              <div className="space-y-3 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Speed</p>
                  <Switch checked={speedEnabled} onCheckedChange={setSpeedEnabled} />
                </div>
                {speedEnabled ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Mode</span>
                      <NativeSelect value={speedMode} onChange={(event) => setSpeedMode(event.target.value as VideoSpeedMode)}>
                        <option value="relative">Relative (px/s)</option>
                        <option value="calibrated">Calibrated (m/s, km/h)</option>
                      </NativeSelect>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Meters per pixel (optional)</span>
                      <Input
                        value={metersPerPixel}
                        onChange={(event) => setMetersPerPixel(event.target.value)}
                        placeholder="0.0125"
                        disabled={speedMode !== "calibrated"}
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <span>Trails</span>
                  <Switch checked={trailsEnabled} onCheckedChange={setTrailsEnabled} />
                </label>
                {trailsEnabled ? (
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Trail frames</span>
                    <Input value={trailFrames} onChange={(event) => setTrailFrames(event.target.value)} />
                  </label>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                    Trails are off.
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                Estimated OpenAI keyframe calls: {estimatedCalls}
              </div>

              <Button disabled={busy} onClick={() => void onCreateRun()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clapperboard className="mr-2 h-4 w-4" />}
                {busy ? "Starting..." : "Run"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Runs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {loadingRuns ? <p className="text-sm text-muted-foreground">Loading runs...</p> : null}
              {!loadingRuns && runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No runs yet. Start a new video run.</p>
              ) : null}
              {runs.map((run) => (
                <button
                  key={run.run_id}
                  type="button"
                  onClick={() => setSelectedRunId(run.run_id)}
                  className={`w-full rounded-xl border p-3 text-left ${
                    run.run_id === selectedRunId ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{run.run_id}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(run.created_at)}</p>
                    </div>
                    <Badge
                      variant={
                        run.status === "done"
                          ? "secondary"
                          : run.status === "failed"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {run.status}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {run.summary?.targets.join(", ") || "targets pending"} • {run.summary?.mode || "mode pending"}
                  </p>
                  <p className="text-xs text-muted-foreground">Stage: {formatStage(run.stage)}</p>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Run Viewer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedRun ? (
                <p className="text-sm text-muted-foreground">Select a run to inspect outputs.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        selectedRun.status === "done"
                          ? "secondary"
                          : selectedRun.status === "failed"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {selectedRun.status}
                    </Badge>
                    <Badge variant="outline">{formatStage(selectedRun.stage)}</Badge>
                    {selectedRun.stage_progress != null ? (
                      <Badge variant="outline">{Math.round(selectedRun.stage_progress * 100)}%</Badge>
                    ) : null}
                  </div>

                  {selectedRun.status === "processing" ? (
                    <p className="text-sm text-muted-foreground">
                      Processing: {formatStage(selectedRun.stage)}. You can navigate away and return later.
                    </p>
                  ) : null}
                  {selectedRun.error ? <p className="text-sm text-destructive">{selectedRun.error}</p> : null}

                  {selectedRun.status === "done" ? (
                    <>
                      <div className="relative overflow-hidden rounded-xl border border-border bg-black/90">
                        <video
                          ref={viewerVideoRef}
                          controls
                          src={`/api/v2/projects/${projectId}/video-runs/${selectedRun.run_id}/work`}
                          className="w-full"
                        />
                        <canvas ref={viewerCanvasRef} className="pointer-events-none absolute inset-0" />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant={showBoxes ? "default" : "outline"} onClick={() => setShowBoxes((v) => !v)}>
                          Boxes
                        </Button>
                        <Button size="sm" variant={showIds ? "default" : "outline"} onClick={() => setShowIds((v) => !v)}>
                          IDs
                        </Button>
                        <Button size="sm" variant={showTrails ? "default" : "outline"} onClick={() => setShowTrails((v) => !v)}>
                          Trails
                        </Button>
                        <Button size="sm" variant={showSpeed ? "default" : "outline"} onClick={() => setShowSpeed((v) => !v)}>
                          Speed
                        </Button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                          <a href={`/api/v2/projects/${projectId}/video-runs/${selectedRun.run_id}/annotated`}>
                            <Download className="mr-2 h-4 w-4" />
                            Export MP4
                          </a>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <a href={`/api/v2/projects/${projectId}/video-runs/${selectedRun.run_id}/tracks`}>
                            <Download className="mr-2 h-4 w-4" />
                            Tracks JSON
                          </a>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <a href={`/api/v2/projects/${projectId}/video-runs/${selectedRun.run_id}/metadata`}>
                            <Download className="mr-2 h-4 w-4" />
                            Run Metadata
                          </a>
                        </Button>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Inspector</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {selectedRun ? (
                <>
                  <p>
                    <span className="text-muted-foreground">Run:</span> {selectedRun.run_id}
                  </p>
                  <p>
                    <span className="text-muted-foreground">FPS / Stride:</span>{" "}
                    {selectedRun.processing.fps_work} / {selectedRun.processing.inference_stride_frames}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Confidence:</span>{" "}
                    {selectedRun.processing.confidence_threshold.toFixed(2)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Keyframe calls:</span>{" "}
                    {selectedRun.openai.requests.num_images_sent}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Model:</span> {selectedRun.openai.model} (
                    {selectedRun.openai.reasoning_effort})
                  </p>
                  <p>
                    <span className="text-muted-foreground">Tracks:</span> {tracks?.tracks.length ?? "-"}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">No run selected.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {message ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          <PlayCircle className="mr-1 inline-block h-4 w-4" />
          {message}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
