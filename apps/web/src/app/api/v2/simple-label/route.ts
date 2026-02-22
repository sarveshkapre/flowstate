import { NextResponse } from "next/server";
import { z } from "zod";

import { readArtifactBytes } from "@/lib/data-store";
import { resolveOpenAIModel } from "@/lib/openai-model";
import { getOpenAIClient } from "@/lib/openai";
import { requireV1Permission } from "@/lib/v1/auth";

const requestSchema = z.object({
  artifactId: z.string().uuid(),
  prompt: z.string().min(1).max(4000).optional(),
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
    const model = resolveOpenAIModel();
    const response = await openai.responses.create({
      model,
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
    let parsedJson: unknown = null;
    try {
      parsedJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsedJson = null;
    }

    return NextResponse.json({
      artifactId: artifactRecord.artifact.id,
      model,
      responseText,
      parsedJson,
      output: response.output ?? [],
      usage: response.usage ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Auto-label request failed." },
      { status: 500 },
    );
  }
}

