import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";

import { z } from "zod";

import {
  createAssetAnnotation,
  getDatasetAsset,
  resolveDatasetAssetBinarySource,
} from "@/lib/data-store-v2";
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

const modelOutputSchema = z.object({
  shapes: z.array(autoLabelModelShapeSchema).min(0),
});

export type AutoLabelShape = z.infer<typeof autoLabelModelShapeSchema>;
export type AutoLabelModelOutput = z.infer<typeof modelOutputSchema>;

export type AutoLabelOptions = {
  prompt?: string;
  labelHints?: string[];
  reasoningEffort?: "low" | "medium" | "high";
  actor?: string;
};

const genericLabels = new Set([
  "photo",
  "image",
  "picture",
  "object",
  "item",
  "scene",
  "thing",
  "unknown",
  "other",
]);

function normalizeLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function isGenericLabel(value: string) {
  return genericLabels.has(normalizeLabel(value));
}

function fallbackLabel(index: number) {
  return `unknown_object_${index + 1}`;
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
  const hints = options?.labelHints?.length
    ? `Preferred labels: ${options.labelHints.join(", ")}.`
    : "Infer concise object labels from visible objects.";
  const instruction =
    options?.prompt?.trim() ||
    "Detect and localize visible objects with object detection boxes. " +
      "Use specific class labels (person, car, laptop, bottle). " +
      "Do not use generic labels like object/image/photo/item/scene.";

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
            text: `${instruction}\n${hints}\nReturn normalized bbox values in range [0,1].`,
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
            shapes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: { type: "string" },
                  confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
                  bbox: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      x: { type: "number", minimum: 0, maximum: 1 },
                      y: { type: "number", minimum: 0, maximum: 1 },
                      width: { type: "number", minimum: 0, maximum: 1 },
                      height: { type: "number", minimum: 0, maximum: 1 },
                    },
                    required: ["x", "y", "width", "height"],
                  },
                },
                required: ["label", "bbox", "confidence"],
              },
            },
          },
          required: ["shapes"],
        },
        strict: true,
      },
    },
  });

  const outputText = response.output_text || "{}";
  const parsedOutput = modelOutputSchema.parse(JSON.parse(outputText));
  let normalizedShapes = parsedOutput.shapes.map((shape, index) => {
    const label = normalizeLabel(shape.label);
    return {
      ...shape,
      label: label || fallbackLabel(index),
    };
  });

  const needsRelabel = normalizedShapes.some((shape) => isGenericLabel(shape.label));
  if (needsRelabel && normalizedShapes.length > 0) {
    try {
      const relabelResponse = await openai.responses.create({
        model: resolveOpenAIModel(),
        reasoning: {
          effort: options?.reasoningEffort ?? "medium",
        },
        text: {
          format: {
            type: "json_schema",
            name: "asset_relabels",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                labels: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      index: { type: "number", minimum: 0 },
                      label: { type: "string" },
                    },
                    required: ["index", "label"],
                  },
                },
              },
              required: ["labels"],
            },
            strict: true,
          },
        },
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You relabel detections using specific object class names. " +
                  "Never use generic labels like object/image/photo/item/scene/thing.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  `Relabel these detections:\n${JSON.stringify(
                    normalizedShapes.map((shape, index) => ({
                      index,
                      current_label: shape.label,
                      bbox: shape.bbox,
                    })),
                  )}`,
              },
              {
                type: "input_image",
                image_url: `data:${source.mimeType};base64,${base64Image}`,
                detail: "high",
              },
            ],
          },
        ],
      });

      const relabelText = relabelResponse.output_text?.trim() ?? "";
      if (relabelText) {
        const relabelPayload = z
          .object({
            labels: z.array(
              z.object({
                index: z.number().int().nonnegative(),
                label: z.string().min(1),
              }),
            ),
          })
          .parse(JSON.parse(relabelText));

        for (const entry of relabelPayload.labels) {
          const shape = normalizedShapes[entry.index];
          if (!shape) {
            continue;
          }
          const label = normalizeLabel(entry.label);
          if (!label || isGenericLabel(label)) {
            continue;
          }
          shape.label = label;
        }
      }
    } catch {
      // Keep base detections if relabel step fails.
    }
  }

  normalizedShapes = normalizedShapes.map((shape, index) => {
    if (!shape.label || isGenericLabel(shape.label)) {
      return {
        ...shape,
        label: fallbackLabel(index),
      };
    }
    return shape;
  });

  const annotation = await createAssetAnnotation({
    assetId,
    source: "ai_prelabel",
    shapes: normalizedShapes.map((shape) => ({
      id: randomUUID(),
      label: shape.label,
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
    model_output: { shapes: normalizedShapes },
  };
}
