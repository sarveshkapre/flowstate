import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { readArtifactBytes } from "@/lib/data-store";
import { createAssetAnnotation, getDatasetAsset } from "@/lib/data-store-v2";
import { getOpenAIClient } from "@/lib/openai";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ assetId: string }>;
};

const autoLabelSchema = z.object({
  prompt: z.string().max(3000).optional(),
  labelHints: z.array(z.string().min(1).max(200)).max(100).optional(),
});

const modelOutputSchema = z.object({
  shapes: z.array(
    z.object({
      label: z.string().min(1),
      confidence: z.number().min(0).max(1).nullable().optional(),
      bbox: z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0).max(1),
        height: z.number().min(0).max(1),
      }),
    }),
  ),
});

function buildImageInput(mimeType: string, bytes: Buffer) {
  if (!mimeType.startsWith("image/")) {
    throw new Error("Auto-label currently supports image assets only.");
  }

  const base64 = bytes.toString("base64");
  return {
    type: "input_image" as const,
    image_url: `data:${mimeType};base64,${base64}`,
    detail: "high" as const,
  };
}

export async function POST(request: Request, { params }: Params) {
  const { assetId } = await params;
  const asset = await getDatasetAsset(assetId);

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "run_flow",
    projectId: asset.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => ({}));
  const parsed = autoLabelSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  if (!asset.artifact_id) {
    return NextResponse.json({ error: "Asset is missing backing artifact. Unable to auto-label." }, { status: 400 });
  }

  const artifactFile = await readArtifactBytes(asset.artifact_id);
  if (!artifactFile) {
    return NextResponse.json({ error: "Asset file could not be read." }, { status: 404 });
  }

  try {
    const openai = getOpenAIClient();
    const hints = parsed.data.labelHints?.length
      ? `Preferred labels: ${parsed.data.labelHints.join(", ")}.`
      : "Infer concise labels from visible objects.";
    const instruction = parsed.data.prompt?.trim() || "Detect prominent objects and return bounding boxes.";

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You are a precise annotation assistant for computer vision labeling.",
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
            buildImageInput(artifactFile.artifact.mime_type, artifactFile.bytes),
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
                  required: ["label", "bbox"],
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
      notes: `Auto-labeled by ${process.env.OPENAI_MODEL || "gpt-4.1-mini"}`,
      actor: auth.actor.email ?? undefined,
    });

    return NextResponse.json({ annotation, model_output: parsedOutput });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto-label failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
