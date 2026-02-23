import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";

import { z } from "zod";

import {
  createAssetAnnotation,
  getDatasetAsset,
  resolveDatasetAssetBinarySource,
} from "@/lib/data-store-v2";
import { inferImageDimensionsFromBuffer } from "@/lib/image-dimensions";
import { createResponseWithReasoningFallback } from "@/lib/openai-responses";
import { getOpenAIClient } from "@/lib/openai";

export const autoLabelModelShapeSchema = z.object({
  label: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
  bbox: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  }),
});

const modelResponseSchema = z.object({
  objects: z.array(
    z.object({
      label: z.string().min(1),
      confidence: z.number().min(0).max(1).nullable(),
      bbox_xywh: z.tuple([
        z.number().nonnegative(),
        z.number().nonnegative(),
        z.number().nonnegative(),
        z.number().nonnegative(),
      ]),
    }),
  ),
});
const autoLabelModelOutputSchema = z.object({
  shapes: z.array(autoLabelModelShapeSchema).min(0),
});

export type AutoLabelShape = z.infer<typeof autoLabelModelShapeSchema>;
export type AutoLabelModelOutput = z.infer<typeof autoLabelModelOutputSchema>;

export type AutoLabelOptions = {
  prompt?: string;
  labelHints?: string[];
  reasoningEffort?: "low" | "medium" | "high";
  maxObjects?: number;
  qualityMode?: "fast" | "dense";
  actor?: string;
};

const DEFAULT_AUTO_LABEL_PROMPT =
  "You are a computer vision data labeling expert. Auto-label the image with accurate, tight bounding boxes and " +
  "specific object labels.";

const DEFAULT_MAX_OBJECTS = 250;
const DENSE_MAX_OBJECTS = 400;
const AUTO_LABEL_MODEL = "gpt-5.2";
const DUPLICATE_IOU_THRESHOLD = 0.88;
const GENERIC_LABELS = new Set([
  "object",
  "objects",
  "thing",
  "things",
  "item",
  "items",
  "photo",
  "image",
  "picture",
  "scene",
  "content",
  "entity",
]);

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function normalizeLabel(value: string) {
  const label = value.trim().replace(/\s+/g, " ");
  if (!label) {
    return "object";
  }
  const lowered = label.toLowerCase();
  if (lowered === "item" || lowered === "thing") {
    return "object";
  }
  return lowered;
}

function filterUnhelpfulLabels(objects: PixelObject[]) {
  const filtered = objects.filter((item) => !GENERIC_LABELS.has(item.label));
  if (filtered.length > 0) {
    return filtered;
  }
  return objects;
}

type PixelObject = {
  label: string;
  confidence: number | null;
  bbox_xywh: [number, number, number, number];
};

function sanitizePixelObject(
  object: z.output<typeof modelResponseSchema>["objects"][number],
  imageWidth: number,
  imageHeight: number,
): PixelObject | null {
  const [rawX, rawY, rawW, rawH] = object.bbox_xywh;
  const x = clamp(rawX, 0, imageWidth - 1);
  const y = clamp(rawY, 0, imageHeight - 1);
  const width = clamp(rawW, 0, imageWidth - x);
  const height = clamp(rawH, 0, imageHeight - y);
  if (width < 1 || height < 1) {
    return null;
  }

  return {
    label: normalizeLabel(object.label),
    confidence: object.confidence ?? null,
    bbox_xywh: [x, y, width, height],
  };
}

function iou(left: PixelObject, right: PixelObject) {
  const [lx, ly, lw, lh] = left.bbox_xywh;
  const [rx, ry, rw, rh] = right.bbox_xywh;
  const l2x = lx + lw;
  const l2y = ly + lh;
  const r2x = rx + rw;
  const r2y = ry + rh;

  const ix = Math.max(lx, rx);
  const iy = Math.max(ly, ry);
  const i2x = Math.min(l2x, r2x);
  const i2y = Math.min(l2y, r2y);

  const iw = Math.max(0, i2x - ix);
  const ih = Math.max(0, i2y - iy);
  const intersection = iw * ih;
  if (intersection <= 0) {
    return 0;
  }

  const leftArea = lw * lh;
  const rightArea = rw * rh;
  const union = leftArea + rightArea - intersection;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}

function dedupePixelObjects(objects: PixelObject[], maxObjects: number) {
  const sorted = [...objects].sort((left, right) => {
    const leftConfidence = left.confidence ?? -1;
    const rightConfidence = right.confidence ?? -1;
    if (rightConfidence !== leftConfidence) {
      return rightConfidence - leftConfidence;
    }
    const leftArea = left.bbox_xywh[2] * left.bbox_xywh[3];
    const rightArea = right.bbox_xywh[2] * right.bbox_xywh[3];
    return rightArea - leftArea;
  });

  const kept: PixelObject[] = [];
  for (const candidate of sorted) {
    const duplicate = kept.some((existing) => {
      const overlap = iou(existing, candidate);
      if (overlap < DUPLICATE_IOU_THRESHOLD) {
        return false;
      }

      if (existing.label === candidate.label) {
        return true;
      }

      if (existing.label === "object" || candidate.label === "object") {
        return true;
      }

      return false;
    });
    if (!duplicate) {
      kept.push(candidate);
    }
    if (kept.length >= maxObjects) {
      break;
    }
  }

  return kept;
}

function promptForPass(input: {
  instruction: string;
  hints: string;
  imageWidth: number;
  imageHeight: number;
  maxObjects: number;
  qualityMode: "fast" | "dense";
  priorDetections?: PixelObject[];
}) {
  const priorDetections = input.priorDetections ?? [];
  const refinementPass = priorDetections.length > 0;
  const base = [
    input.instruction,
    input.hints,
    "Task: produce production-quality computer vision dataset annotations.",
    "Focus on semantically meaningful foreground task objects.",
    "Ignore browser/player controls, UI overlays, watermark chrome, and incidental tiny background clutter unless the user explicitly asks for them.",
    "Output absolute pixel bounding boxes as [x,y,w,h] with top-left origin.",
    `Image size is ${input.imageWidth}x${input.imageHeight}.`,
    `Return at most ${input.maxObjects} objects.`,
    "Use specific short singular noun labels. Avoid generic labels like object, thing, photo, image, or scene.",
    "If uncertain, keep the best-effort label and lower confidence.",
  ];

  if (input.qualityMode === "dense") {
    base.push(
      "Dense mode: detect every visible distinct instance, not just the most salient ones.",
      "If this looks like a collage/montage grid, treat each tile as one instance and label each tile by its dominant object/category.",
      "Prefer full coverage for annotation over brevity.",
    );
  } else {
    base.push("Return the most important instances first.");
  }

  if (refinementPass) {
    const compact = priorDetections.slice(0, 200).map((item) => ({
      label: item.label,
      confidence: item.confidence,
      bbox_xywh: item.bbox_xywh.map((value) => Math.round(value * 10) / 10),
    }));
    base.push(
      "Refinement pass on top of seeded detections:",
      "1) tighten box boundaries",
      "2) replace generic labels with specific labels",
      "3) add obvious missed salient objects",
      "4) remove duplicates",
      "5) remove detections that are just player/browser UI controls or non-semantic background noise",
      `Existing detections seed:\n${JSON.stringify(compact)}`,
    );
  }

  return base.filter(Boolean).join("\n");
}

async function runDetectionPass(input: {
  base64Image: string;
  mimeType: string;
  instruction: string;
  hints: string;
  imageWidth: number;
  imageHeight: number;
  maxObjects: number;
  reasoningEffort: "low" | "medium" | "high";
  qualityMode: "fast" | "dense";
  priorDetections?: PixelObject[];
}) {
  const openai = getOpenAIClient();
  const response = await createResponseWithReasoningFallback(openai, {
    model: AUTO_LABEL_MODEL,
    reasoning: {
      effort: input.reasoningEffort,
    },
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You are a meticulous computer vision data labeling expert.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: promptForPass({
              instruction: input.instruction,
              hints: input.hints,
              imageWidth: input.imageWidth,
              imageHeight: input.imageHeight,
              maxObjects: input.maxObjects,
              qualityMode: input.qualityMode,
              priorDetections: input.priorDetections,
            }),
          },
          {
            type: "input_image",
            image_url: `data:${input.mimeType};base64,${input.base64Image}`,
            detail: "high",
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "asset_auto_labels",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            objects: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: { type: "string" },
                  confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
                  bbox_xywh: {
                    type: "array",
                    items: { type: "number", minimum: 0 },
                    minItems: 4,
                    maxItems: 4,
                  },
                },
                required: ["label", "bbox_xywh", "confidence"],
              },
            },
          },
          required: ["objects"],
        },
        strict: true,
      },
    },
  });

  const outputText = response.output_text || "{}";
  const parsed = modelResponseSchema.parse(JSON.parse(outputText));
  const objects = parsed.objects
    .map((item) => sanitizePixelObject(item, input.imageWidth, input.imageHeight))
    .filter((item): item is PixelObject => item !== null);
  return dedupePixelObjects(objects, input.maxObjects);
}

export async function runAssetAutoLabel(assetId: string, options?: AutoLabelOptions) {
  const asset = await getDatasetAsset(assetId);
  if (!asset) {
    throw new Error("Asset not found");
  }

  if (asset.asset_type !== "image" && asset.asset_type !== "video_frame") {
    throw new Error("Auto-label supports image and extracted video frame assets only.");
  }

  if (!asset.artifact_id) {
    throw new Error("Asset is missing backing artifact. Unable to auto-label.");
  }

  const source = await resolveDatasetAssetBinarySource(asset);
  if (!source) {
    throw new Error("Asset file could not be read.");
  }

  const sourceBytes = await fs.readFile(source.filePath);
  const base64Image = sourceBytes.toString("base64");
  const instruction = options?.prompt?.trim() || DEFAULT_AUTO_LABEL_PROMPT;
  const hints =
    options?.labelHints && options.labelHints.length > 0
      ? `Preferred labels: ${options.labelHints.join(", ")}.`
      : "";
  const qualityMode = options?.qualityMode ?? "fast";
  const maxObjects =
    typeof options?.maxObjects === "number" && Number.isFinite(options.maxObjects)
      ? clamp(Math.floor(options.maxObjects), 1, 1000)
      : qualityMode === "dense"
        ? DENSE_MAX_OBJECTS
        : DEFAULT_MAX_OBJECTS;
  const dimensionsFromBytes = inferImageDimensionsFromBuffer(sourceBytes);
  const imageWidth =
    asset.width && asset.width > 0 ? asset.width : dimensionsFromBytes?.width ?? null;
  const imageHeight =
    asset.height && asset.height > 0 ? asset.height : dimensionsFromBytes?.height ?? null;
  if (!imageWidth || !imageHeight) {
    throw new Error("Unable to determine image dimensions for auto-label.");
  }

  const reasoningEffort = options?.reasoningEffort ?? "medium";
  const firstPass = await runDetectionPass({
    base64Image,
    mimeType: source.mimeType,
    instruction,
    hints,
    imageWidth,
    imageHeight,
    maxObjects,
    reasoningEffort,
    qualityMode,
  });

  let finalObjects = firstPass;
  if (firstPass.length > 0) {
    try {
      const refined = await runDetectionPass({
        base64Image,
        mimeType: source.mimeType,
        instruction,
        hints,
        imageWidth,
        imageHeight,
        maxObjects,
        reasoningEffort,
        qualityMode,
        priorDetections: firstPass,
      });
      finalObjects = refined.length > 0 ? refined : firstPass;
    } catch {
      finalObjects = firstPass;
    }
  }
  finalObjects = filterUnhelpfulLabels(finalObjects);

  const shapes = finalObjects.map((item) => {
    const [x, y, width, height] = item.bbox_xywh;
    return {
      label: item.label,
      confidence: item.confidence ?? null,
      bbox: {
        x: x / imageWidth,
        y: y / imageHeight,
        width: width / imageWidth,
        height: height / imageHeight,
      },
    };
  });

  const annotation = await createAssetAnnotation({
    assetId,
    source: "ai_prelabel",
    shapes: shapes.map((shape) => ({
      id: randomUUID(),
      label: shape.label.trim(),
      confidence: shape.confidence ?? null,
      geometry: {
        type: "bbox",
        x: shape.bbox.x,
        y: shape.bbox.y,
        width: shape.bbox.width,
        height: shape.bbox.height,
      },
    })),
    notes: `Auto-labeled by ${AUTO_LABEL_MODEL} (${qualityMode})`,
    actor: options?.actor,
  });

  return {
    annotation,
    model_output: autoLabelModelOutputSchema.parse({ shapes }),
  };
}
