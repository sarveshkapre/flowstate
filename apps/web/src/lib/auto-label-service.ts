import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";

import { z } from "zod";

import {
  createAssetAnnotation,
  getDatasetAsset,
  resolveDatasetAssetBinarySource,
} from "@/lib/data-store-v2";
import { inferImageDimensionsFromBuffer } from "@/lib/image-dimensions";
import { resolveOpenAIModel } from "@/lib/openai-model";
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
  actor?: string;
};

const DEFAULT_AUTO_LABEL_PROMPT =
  "You are data labeling expert for computer vision tasks - autolabel, bounding boxes, and labels for the image. " +
  "Make sure it is accurate.";

const DEFAULT_MAX_OBJECTS = 250;

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
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
  const maxObjects =
    typeof options?.maxObjects === "number" && Number.isFinite(options.maxObjects)
      ? clamp(Math.floor(options.maxObjects), 1, 1000)
      : DEFAULT_MAX_OBJECTS;
  const dimensionsFromBytes = inferImageDimensionsFromBuffer(sourceBytes);
  const imageWidth =
    asset.width && asset.width > 0 ? asset.width : dimensionsFromBytes?.width ?? null;
  const imageHeight =
    asset.height && asset.height > 0 ? asset.height : dimensionsFromBytes?.height ?? null;
  if (!imageWidth || !imageHeight) {
    throw new Error("Unable to determine image dimensions for auto-label.");
  }

  const openai = getOpenAIClient();
  const response = await openai.responses.create({
    model: resolveOpenAIModel(),
    reasoning: {
      effort: options?.reasoningEffort ?? "medium",
    },
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You are a computer vision labeling expert for vision AI datasets.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `${instruction}\n${hints}\n` +
              `Return absolute pixel bounding boxes in [x,y,w,h] format.\n` +
              `Image size is ${imageWidth}x${imageHeight}.\n` +
              `Return the most salient objects first and limit to ${maxObjects} objects.`,
          },
          {
            type: "input_image",
            image_url: `data:${source.mimeType};base64,${base64Image}`,
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
  const parsedOutput = modelResponseSchema.parse(JSON.parse(outputText));
  const shapes = parsedOutput.objects
    .map((item) => {
      const [rawX, rawY, rawW, rawH] = item.bbox_xywh;
      const x = clamp(rawX, 0, imageWidth - 1);
      const y = clamp(rawY, 0, imageHeight - 1);
      const width = clamp(rawW, 0, imageWidth - x);
      const height = clamp(rawH, 0, imageHeight - y);
      if (width < 1 || height < 1) {
        return null;
      }
      return {
        label: item.label.trim(),
        confidence: item.confidence ?? null,
        bbox: {
          x: x / imageWidth,
          y: y / imageHeight,
          width: width / imageWidth,
          height: height / imageHeight,
        },
      };
    })
    .filter((item): item is AutoLabelShape => item !== null);

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
    notes: `Auto-labeled by ${resolveOpenAIModel()}`,
    actor: options?.actor,
  });

  return {
    annotation,
    model_output: autoLabelModelOutputSchema.parse({ shapes }),
  };
}
