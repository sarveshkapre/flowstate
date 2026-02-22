import { NextResponse } from "next/server";
import { z } from "zod";

import { readArtifactBytes } from "@/lib/data-store";
import { getOpenAIClient } from "@/lib/openai";
import { requireV1Permission } from "@/lib/v1/auth";

const LAYOUT_MODEL = "gpt-5.2";

const requestSchema = z.object({
  artifactId: z.string().uuid(),
  prompt: z.string().min(1).max(4000).optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
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
  "You are a computer vision labeling expert for production annotation.\n" +
  "Return every visible object as a separate instance.\n" +
  "Do not group nearby objects into one box. If multiple instances of same label exist, list each one.\n" +
  "Use specific object class names (examples: person, car, laptop, mug, bottle, dog).\n" +
  "Do not use generic labels like photo, image, picture, object, item, or scene.\n" +
  "Use normalized coordinates in [0,1] only.\n" +
  "Return JSON exactly as: {\"objects\":[{label,bbox,confidence}]}, where bbox is {x,y,width,height} in 0-1 range.\n" +
  "Confidence is optional; use null if uncertain, and keep it between 0 and 1 when provided.\n" +
  "Aim for thorough coverage of the full scene.";

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

    let objects = parsedOutput.objects.map((object, index) => {
      const nextLabel = normalizeLabel(object.label);
      return {
        ...object,
        label: nextLabel.length > 0 ? nextLabel : fallbackLabel(index),
      };
    });

    const needsRelabel = objects.some((object) => isGenericLabel(object.label));
    if (needsRelabel && objects.length > 0) {
      try {
        const relabelResponse = await openai.responses.create({
          model: LAYOUT_MODEL,
          text: {
            format: {
              type: "json_schema",
              name: "object_relabels",
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
                    "You relabel existing bounding boxes with specific object class names. " +
                    "Use concrete nouns. Never return photo/image/picture/object/item/scene/thing.",
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text:
                    `Relabel these detections using specific class names:\n${JSON.stringify(
                      objects.map((object, index) => ({
                        index,
                        current_label: object.label,
                        bbox: object.bbox,
                      })),
                    )}`,
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
            const currentObject = objects[entry.index];
            if (!currentObject) {
              continue;
            }
            const next = normalizeLabel(entry.label);
            if (!next || isGenericLabel(next)) {
              continue;
            }
            currentObject.label = next;
          }
        }
      } catch {
        // Keep primary detection output if relabel pass fails.
      }
    }

    objects = objects.map((object, index) =>
      isGenericLabel(object.label)
        ? {
            ...object,
            label: fallbackLabel(index),
          }
        : object,
    );

    return NextResponse.json({
      artifactId: artifactRecord.artifact.id,
      model: LAYOUT_MODEL,
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
