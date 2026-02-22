/* eslint-disable @next/next/no-img-element */
"use client";

import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { Download, Loader2, Upload, WandSparkles } from "lucide-react";

import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";

type UploadResponse = {
  artifact: {
    id: string;
  };
  error?: string;
};

type BBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LabelObject = {
  label: string;
  confidence?: number | null;
  bbox: BBox;
};

type MappedLabelObject = {
  label: string;
  confidence?: number | null;
  bbox: BBox;
};

type AutoLabelResponse = {
  artifactId: string;
  model: string;
  objects: LabelObject[];
  rawOutput: string;
  usage: unknown;
  reasoningEffort?: string;
};

type CocoCategory = {
  id: number;
  name: string;
  supercategory: "object";
};

type CocoAnnotation = {
  id: number;
  image_id: number;
  category_id: number;
  bbox: readonly [number, number, number, number];
  area: number;
  iscrowd: number;
};

type CocoImage = {
  id: number;
  file_name: string;
  width: number;
  height: number;
};

type CocoPayload = {
  images: CocoImage[];
  annotations: CocoAnnotation[];
  categories: CocoCategory[];
};

type LabelJobStatus = "idle" | "uploading" | "labeling" | "done" | "error";

type LabelJob = {
  id: string;
  file: File;
  previewUrl: string;
  status: LabelJobStatus;
  error: string | null;
  model?: string;
  objects?: LabelObject[];
  rawOutput?: string;
  annotatedImageUrl?: string;
  coco?: CocoPayload;
  coordinateMode?: "normalized" | "pixel";
};

const DEFAULT_PROMPT =
  "You are a computer vision labeling expert for production annotation.\n" +
  "Return every visible object as a separate instance.\n" +
  "Do not group nearby objects into one box. If multiple instances of the same label exist, list each one.\n" +
  "Use specific object class names (examples: person, car, laptop, mug, bottle, dog).\n" +
  "Do not use generic labels like photo, image, picture, object, item, or scene.\n" +
  "Use normalized coordinates in [0, 1] only.\n" +
  "Return JSON exactly as {\"objects\": [ { \"label\", \"bbox\", \"confidence\" } ] }.\n" +
  "Include one entry per object and keep confidence between 0 and 1.";

const REASONING_OPTIONS = ["low", "medium", "high"] as const;

type ReasoningEffort = (typeof REASONING_OPTIONS)[number];

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function formatLabelForDisplay(value: string) {
  const normalized = value.trim().replace(/[_-]+/g, " ");
  return normalized || "unknown object";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read image for preview."));
    reader.readAsDataURL(file);
  });
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const imageElement = new Image();
    const blobUrl = URL.createObjectURL(file);

    imageElement.onload = () => {
      URL.revokeObjectURL(blobUrl);
      resolve(imageElement);
    };

    imageElement.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error("Unable to load uploaded image."));
    };

    imageElement.src = blobUrl;
  });
}

function downloadContent(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function toCocoPayload(fileName: string, width: number, height: number, objects: LabelObject[]): CocoPayload {
  const pixelObjects = mapObjectsToPixels(objects, width, height);
  const payload = toCocoPayloadWithMode(fileName, width, height, pixelObjects);

  return {
    images: payload.images,
    annotations: payload.annotations,
    categories: payload.categories,
  };
}

function mapObjectsToPixels(objects: LabelObject[], imageWidth: number, imageHeight: number): MappedLabelObject[] {
  const { mapped } = mapAndValidateBoxes(objects, imageWidth, imageHeight);

  return mapped.filter((object): object is MappedLabelObject => {
    const { x, y, width, height } = object.bbox;

    return x >= 0 && y >= 0 && width > 0 && height > 0 && Number.isFinite(x + y + width + height);
  });
}

function mapAndValidateBoxes(objects: LabelObject[], width: number, height: number) {
  const coordinateMode = inferCoordinateMode(objects, width, height);

  return {
    coordinateMode,
    mapped: objects.map((object) => normalizeObjectToPixels(object, width, height, coordinateMode)),
  };
}

function inferCoordinateMode(objects: LabelObject[], width: number, height: number): "normalized" | "pixel" {
  let pixelCount = 0;
  let normalizedCount = 0;

  for (const object of objects) {
    const { bbox } = object;
    const maxValue = Math.max(bbox.x, bbox.y, bbox.width, bbox.height);
    const minValue = Math.min(bbox.x, bbox.y, bbox.width, bbox.height);
    const hasNegative = minValue < 0;

    if (!hasNegative && maxValue <= 1) {
      normalizedCount += 1;
      continue;
    }

    if (!hasNegative && (bbox.x <= width && bbox.width <= width && bbox.y <= height && bbox.height <= height)) {
      pixelCount += 1;
    }
  }

  if (pixelCount === 0 && normalizedCount === 0) {
    return "normalized";
  }

  return pixelCount > normalizedCount ? "pixel" : "normalized";
}

function normalizeObjectToPixels(
  object: LabelObject,
  imageWidth: number,
  imageHeight: number,
  coordinateMode: "normalized" | "pixel",
): MappedLabelObject {
  const sourceWidth = coordinateMode === "normalized" ? 1 : imageWidth;
  const sourceHeight = coordinateMode === "normalized" ? 1 : imageHeight;
  const x = clamp01(object.bbox.x / sourceWidth) * imageWidth;
  const y = clamp01(object.bbox.y / sourceHeight) * imageHeight;
  const width = clamp01(object.bbox.width / sourceWidth) * imageWidth;
  const height = clamp01(object.bbox.height / sourceHeight) * imageHeight;

  return {
    label: object.label,
    confidence: object.confidence,
    bbox: {
      x,
      y,
      width,
      height,
    },
  };
}

function toCocoPayloadWithMode(
  fileName: string,
  width: number,
  height: number,
  objects: MappedLabelObject[],
): CocoPayload & { coordinateMode: "normalized" | "pixel" } {
  const categorySet = new Map<string, number>();
  const categories = objects.reduce((accumulator: CocoCategory[], current) => {
    const key = current.label.trim();
    if (!key) {
      return accumulator;
    }

    if (!categorySet.has(key)) {
      const id = categorySet.size + 1;
      categorySet.set(key, id);
      accumulator.push({ id, name: key, supercategory: "object" });
    }
    return accumulator;
  }, []);

  const annotations = objects.map((object, index) => {
    const label = object.label.trim();
    const categoryId = categorySet.get(label) ?? 1;

    return {
      id: index + 1,
      image_id: 1,
      category_id: categoryId,
      bbox: [
        Number(object.bbox.x.toFixed(2)),
        Number(object.bbox.y.toFixed(2)),
        Number(object.bbox.width.toFixed(2)),
        Number(object.bbox.height.toFixed(2)),
      ] as const,
      area: Number((object.bbox.width * object.bbox.height).toFixed(2)),
      iscrowd: 0,
    };
  });

  const imageEntry: CocoImage = {
    id: 1,
    file_name: fileName,
    width,
    height,
  };

  return {
    images: [imageEntry],
    annotations,
    categories,
    coordinateMode: "pixel",
  };
}

async function createAnnotatedImage(file: File, objects: LabelObject[]): Promise<{
  annotatedImageUrl: string;
  width: number;
  height: number;
}> {
  const image = await loadImageFromFile(file);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context unavailable.");
  }

  context.drawImage(image, 0, 0, width, height);
  context.font = "14px Inter, Arial, sans-serif";
  context.lineWidth = Math.max(2, Math.round(Math.min(width, height) / 600));

  const mappedObjects = mapObjectsToPixels(objects, width, height);
  mappedObjects.forEach((object, index) => {
    const { x, y, width: w, height: h } = object.bbox;
    const color = `hsl(${(index * 53) % 360}, 70%, 50%)`;
    context.strokeStyle = color;
    context.fillStyle = color;

    if (w < 1 || h < 1) {
      return;
    }

    context.strokeRect(x, y, w, h);

    const confidenceSuffix =
      object.confidence === undefined || object.confidence === null
        ? ""
        : ` (${Math.round(object.confidence * 100)}%)`;
    const text = `#${index + 1} ${formatLabelForDisplay(object.label)}${confidenceSuffix}`;

    const textX = x + 4;
    const textY = Math.max(16, y + 16);
    const metrics = context.measureText(text);
    const labelWidth = Number.isFinite(metrics.width) ? metrics.width : text.length * 7;
    const labelPadX = 6;
    context.fillStyle = "rgba(0,0,0,0.62)";
    context.fillRect(textX - labelPadX / 2, textY - 16, labelWidth + labelPadX, 18);
    context.fillStyle = color;
    context.fillText(text, textX, textY);
  });

  return {
    annotatedImageUrl: canvas.toDataURL("image/png"),
    width,
    height,
  };
}


async function uploadFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/v1/uploads", {
    method: "POST",
    body: formData,
  });

  const payload = (await response.json().catch(() => ({}))) as UploadResponse & {
    error?: string;
  };
  if (!response.ok || !payload.artifact?.id) {
    throw new Error(payload.error || "Upload failed.");
  }

  return payload.artifact.id;
}

async function runAutoLabel(artifactId: string, prompt: string, reasoningEffort: ReasoningEffort): Promise<AutoLabelResponse> {
  const response = await fetch("/api/v2/simple-label", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ artifactId, prompt, reasoningEffort }),
  });

  const payload = (await response.json().catch(() => ({}))) as AutoLabelResponse & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "Auto-label failed.");
  }

  return payload;
}

function downloadDataUrl(filename: string, dataUrl: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
}

export function ProjectsClient() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<LabelJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");

  const selectedCount = useMemo(() => jobs.length, [jobs]);
  const doneCount = useMemo(() => jobs.filter((job) => job.status === "done").length, [jobs]);

  async function onSelectFiles(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []).filter((file) => file.type.startsWith("image/"));
    const withPreviews = await Promise.all(
      files.map(async (file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: await readFileAsDataUrl(file),
        status: "idle" as LabelJobStatus,
        error: null,
      })),
    );

    setJobs(withPreviews);
    setError(null);
    if (input) {
      input.value = "";
    }
  }

  async function onRunAutoLabel() {
    if (jobs.length === 0) {
      return;
    }

    setBusy(true);
    setError(null);

    setJobs((previousJobs) =>
      previousJobs.map((job) => ({
        ...job,
        status: "uploading",
        error: null,
      })),
    );

    await Promise.all(
      jobs.map(async (job) => {
        try {
          const artifactId = await uploadFile(job.file);
          setJobs((previousJobs) =>
            previousJobs.map((current) =>
              current.id === job.id ? { ...current, status: "labeling" } : current,
            ),
          );

          const labelPayload = await runAutoLabel(artifactId, DEFAULT_PROMPT, reasoningEffort);
          const annotated = await createAnnotatedImage(job.file, labelPayload.objects);
          const coco = toCocoPayload(job.file.name, annotated.width, annotated.height, labelPayload.objects);

          setJobs((previousJobs) =>
            previousJobs.map((current) =>
              current.id === job.id
                ? {
                    ...current,
                    status: "done",
                    model: labelPayload.model,
                    objects: labelPayload.objects,
                    rawOutput: labelPayload.rawOutput,
                    annotatedImageUrl: annotated.annotatedImageUrl,
                    coco,
                  }
                : current,
            ),
          );
        } catch (jobError) {
          const message = jobError instanceof Error ? jobError.message : "Unable to label this file.";
          setJobs((previousJobs) =>
            previousJobs.map((current) =>
              current.id === job.id
                ? {
                    ...current,
                    status: "error",
                    error: message,
                  }
                : current,
            ),
          );
        }
      }),
    );

    setBusy(false);
  }

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <Card className="border-0 bg-gradient-to-br from-background to-muted/25 shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Image Auto Label</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload one or many images. We use GPT-5.2 with configurable reasoning effort and return detections plus COCO annotations.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              void onSelectFiles(event);
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md"
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload Images
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => void onRunAutoLabel()}
              disabled={jobs.length === 0 || busy}
            >
              <WandSparkles className="mr-2 h-4 w-4" />
              {busy ? "Labeling..." : "Auto Label"}
            </Button>

            <select
              value={reasoningEffort}
              onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
              className="h-9 rounded-md border border-border/40 bg-background px-3 py-1 text-xs"
              disabled={busy}
            >
              {REASONING_OPTIONS.map((option) => (
                <option value={option} key={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          {jobs.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Selected {selectedCount} image(s), completed {doneCount}/{selectedCount}
            </p>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {jobs.map((job) => (
          <Card key={job.id} className="border border-border/50 bg-background/80">
            <CardHeader>
              <CardTitle className="text-base">{job.file.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(job.status === "uploading" || job.status === "labeling") ? (
                <div className="inline-flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/30 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {job.status === "uploading" ? "Uploading image..." : "Running GPT-5.2 auto-label..."}
                </div>
              ) : null}

              {job.status === "error" ? (
                <p className="text-sm text-destructive">{job.error || "Labeling failed."}</p>
              ) : null}

              {(job.status === "idle" || job.status === "error") ? (
                <img
                  src={job.previewUrl}
                  alt={`${job.file.name} preview`}
                  className="h-auto w-full rounded-lg border border-border/50"
                />
              ) : null}

              {job.status === "done" ? (
                <>
                  <img
                    src={job.annotatedImageUrl}
                    alt={`${job.file.name} annotated`}
                    className="h-auto w-full rounded-lg border border-border/50"
                  />

                  <p className="text-xs text-muted-foreground">Model: {job.model}</p>
                  <p className="text-xs text-muted-foreground">Detected objects: {job.objects?.length ?? 0}</p>
                  {job.objects && job.objects.length > 0 ? (
                    <ul className="max-h-36 overflow-auto rounded border border-border/50 bg-muted/30 p-2 text-xs">
                      {job.objects.map((object, index) => (
                        <li key={`${object.label}-${index}`} className="flex items-center justify-between py-1">
                          <span>{`${index + 1}. ${formatLabelForDisplay(object.label)}`}</span>
                          <span className="text-muted-foreground">
                            {object.confidence === undefined || object.confidence === null
                              ? "n/a"
                              : `${Math.round(object.confidence * 100)}%`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">No detections found. Try higher reasoning effort.</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!job.annotatedImageUrl) {
                          return;
                        }
                        downloadDataUrl(`${job.file.name}-annotated.png`, job.annotatedImageUrl);
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download Annotated Image
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!job.coco) {
                          return;
                        }
                        downloadContent(
                          `${job.file.name}-annotations.coco.json`,
                          JSON.stringify(job.coco, null, 2),
                          "application/json",
                        );
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download COCO JSON
                    </Button>
                  </div>
                </>
              ) : null}

              {job.status === "done" && (!job.coco || !job.annotatedImageUrl) ? (
                <p className="text-xs text-destructive">Missing one or more download artifacts.</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
