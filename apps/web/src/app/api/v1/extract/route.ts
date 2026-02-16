import { NextResponse } from "next/server";
import { z } from "zod";

import { getOpenAIClient } from "@/lib/openai";

const requestSchema = z
  .object({
    imageUrl: z.url().optional(),
    prompt: z.string().min(1).max(1000).optional(),
  })
  .refine((value) => Boolean(value.imageUrl), "imageUrl is required");

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const openai = getOpenAIClient();

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "Extract structured invoice/receipt fields. Return strict JSON.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                parsed.data.prompt ||
                "Extract vendor, date, subtotal, tax, total, currency, and line items.",
            },
            {
              type: "input_image",
              image_url: parsed.data.imageUrl!,
              detail: "auto",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "invoice_extraction",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              vendor: { type: "string" },
              date: { type: "string" },
              subtotal: { type: "number" },
              tax: { type: "number" },
              total: { type: "number" },
              currency: { type: "string" },
              line_items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    description: { type: "string" },
                    quantity: { type: "number" },
                    unit_price: { type: "number" },
                    amount: { type: "number" },
                  },
                  required: ["description", "quantity", "unit_price", "amount"],
                },
              },
            },
            required: ["vendor", "date", "subtotal", "tax", "total", "currency", "line_items"],
          },
          strict: true,
        },
      },
    });

    const outputText = response.output_text || "{}";
    const data = JSON.parse(outputText) as Record<string, unknown>;

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      { error: "Extraction failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
