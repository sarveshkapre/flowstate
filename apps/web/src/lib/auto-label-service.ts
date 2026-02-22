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
  actor?: string;
};

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
    : "Infer concise labels from visible objects.";
  const instruction = options?.prompt?.trim() || "Detect and localize visible objects with object detection boxes.";

  const openai = getOpenAIClient();
  const response = await openai.responses.create({
    model: resolveOpenAIModel(),
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

  const annotation = await createAssetAnnotation({
    assetId,
    source: "ai_prelabel",
    shapes: parsedOutput.shapes.map((shape) => ({
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
    model_output: parsedOutput,
  };
}
