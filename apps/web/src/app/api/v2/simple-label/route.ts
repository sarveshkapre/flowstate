import { NextResponse } from "next/server";
import { z } from "zod";

import { readArtifactBytes } from "@/lib/data-store";
import { inferImageDimensionsFromBuffer } from "@/lib/image-dimensions";
import { getOpenAIClient } from "@/lib/openai";
import { createResponseWithReasoningFallback } from "@/lib/openai-responses";
import { requireV1Permission } from "@/lib/v1/auth";

const LAYOUT_MODEL = "gpt-5.2";

const requestSchema = z.object({
  artifactId: z.string().uuid(),
  prompt: z.string().min(1).max(4000).optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  maxObjects: z.number().int().min(1).max(1000).optional(),
});

const objectSchema = z.object({
  label: z.string().min(1),
  bbox_xywh: z.tuple([
    z.number().nonnegative(),
    z.number().nonnegative(),
    z.number().nonnegative(),
    z.number().nonnegative(),
  ]),
  confidence: z.number().min(0).max(1).nullable(),
});

const responseSchema = z.object({
  objects: z.array(objectSchema),
});

const DEFAULT_MAX_OBJECTS = 250;
const DEFAULT_PROMPT =
  "You are a data labeling expert for computer vision tasks. Auto-label the image with accurate object detections " +
  "and bounding boxes.";

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

export async function POST(request: Request) {
  const unauthorized = await requireV1Permission(request, "run_flow");
  if (unauthorized) {
    return unauthorized;
  }

  const payload = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const artifactRecord = await readArtifactBytes(parsed.data.artifactId);
  if (!artifactRecord) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  if (!artifactRecord.artifact.mime_type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image uploads are supported for this action." }, { status: 400 });
  }

  try {
    const dimensions = inferImageDimensionsFromBuffer(artifactRecord.bytes);
    if (!dimensions) {
      return NextResponse.json({ error: "Unsupported image format for dimension parsing." }, { status: 400 });
    }

    const maxObjects =
      typeof parsed.data.maxObjects === "number" && Number.isFinite(parsed.data.maxObjects)
        ? parsed.data.maxObjects
        : DEFAULT_MAX_OBJECTS;
    const openai = getOpenAIClient();
    const response = await createResponseWithReasoningFallback(openai, {
      model: LAYOUT_MODEL,
      reasoning: {
        effort: parsed.data.reasoningEffort ?? "medium",
      },
      text: {
        format: {
          type: "json_schema",
          name: "image_objects",
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
                    label: {
                      type: "string",
                    },
                    confidence: {
                      type: ["number", "null"],
                      minimum: 0,
                      maximum: 1,
                    },
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
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "You are a meticulous computer vision labeling expert." }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                parsed.data.prompt?.trim() ||
                `${DEFAULT_PROMPT}\n` +
                  `Return pixel [x,y,w,h] bounding boxes with top-left origin.\n` +
                  `Image size is ${dimensions.width}x${dimensions.height}.\n` +
                  `Include only reasonably confident detections.\n` +
                  `Max objects: ${maxObjects}.`,
            },
            {
              type: "input_image",
              image_url: `data:${artifactRecord.artifact.mime_type};base64,${artifactRecord.bytes.toString("base64")}`,
              detail: "high",
            },
          ],
        },
      ],
    });

    const responseText = response.output_text?.trim() || "";
    if (!responseText) {
      return NextResponse.json({ error: "Model returned an empty response." }, { status: 502 });
    }

    let parsedOutput: z.output<typeof responseSchema>;
    try {
      const parsed = JSON.parse(responseText) as unknown;
      parsedOutput = responseSchema.parse(parsed);
    } catch {
      return NextResponse.json(
        {
          error: "Model response did not match expected schema.",
          details: "Expected `{ objects: Array<{ label, bbox_xywh:[x,y,w,h], confidence|null }>`.",
          responseText,
        },
        { status: 502 },
      );
    }
    const objects = parsedOutput.objects
      .map((item) => {
        const [rawX, rawY, rawW, rawH] = item.bbox_xywh;
        const x = clamp(rawX, 0, dimensions.width - 1);
        const y = clamp(rawY, 0, dimensions.height - 1);
        const width = clamp(rawW, 0, dimensions.width - x);
        const height = clamp(rawH, 0, dimensions.height - y);
        if (width < 1 || height < 1) {
          return null;
        }
        return {
          label: item.label.trim(),
          confidence: item.confidence,
          bbox_xywh: [x, y, width, height] as [number, number, number, number],
        };
      })
      .filter(
        (
          item,
        ): item is {
          label: string;
          confidence: number | null;
          bbox_xywh: [number, number, number, number];
        } => item !== null,
      );

    return NextResponse.json({
      artifactId: artifactRecord.artifact.id,
      model: LAYOUT_MODEL,
      image: {
        width: dimensions.width,
        height: dimensions.height,
      },
      objects,
      rawOutput: responseText,
      usage: response.usage ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Auto-label request failed." },
      { status: 500 },
    );
  }
}
