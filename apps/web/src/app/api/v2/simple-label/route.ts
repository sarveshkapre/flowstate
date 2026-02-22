import { NextResponse } from "next/server";
import { z } from "zod";

import { readArtifactBytes } from "@/lib/data-store";
import { getOpenAIClient } from "@/lib/openai";
import { requireV1Permission } from "@/lib/v1/auth";

const LAYOUT_MODEL = "gpt-5.2";

const requestSchema = z.object({
  artifactId: z.string().uuid(),
  prompt: z.string().min(1).max(4000).optional(),
});

const bboxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

const objectSchema = z.object({
  label: z.string().min(1),
  bbox: bboxSchema,
  confidence: z.number().min(0).max(1).optional(),
});

const responseSchema = z.object({
  objects: z.array(objectSchema),
});

const DEFAULT_PROMPT =
  "You are a computer vision expert. Draw bounding boxes for every object in this image and identify each object label. Return concise JSON with an `objects` array where each item has `label`, `bbox` ({x,y,width,height}), and optional `confidence`. Use normalized coordinates in [0,1].";

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
    const openai = getOpenAIClient();
    const response = await openai.responses.create({
      model: LAYOUT_MODEL,
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
            required: ["objects"],
          },
          strict: true,
        },
      },
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "You are a computer vision labeling expert." }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: parsed.data.prompt?.trim() || DEFAULT_PROMPT,
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
          details: "Expected `{ objects: Array<{ label, bbox: {x,y,width,height}, confidence? }>`.",
          responseText,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      artifactId: artifactRecord.artifact.id,
      model: LAYOUT_MODEL,
      objects: parsedOutput.objects,
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
