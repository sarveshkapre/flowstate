import OpenAI from "openai";
import { z } from "zod";

import { resolveOpenAIModel } from "../lib/openai-model";

const payloadSchema = z.object({
  imageUrl: z.url(),
  prompt: z.string().min(1).max(1000).optional(),
});

export async function runExtractionJob(payload: unknown) {
  const parsed = payloadSchema.parse(payload);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.responses.create({
    model: resolveOpenAIModel(),
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: parsed.prompt || "Extract key fields from this invoice image." },
          { type: "input_image", image_url: parsed.imageUrl, detail: "auto" },
        ],
      },
    ],
  });

  return response.output_text;
}
