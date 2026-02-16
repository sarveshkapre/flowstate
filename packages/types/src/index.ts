import { z } from "zod";

export const extractionResultSchema = z.object({
  vendor: z.string(),
  date: z.string(),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
  currency: z.string(),
  line_items: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unit_price: z.number(),
      amount: z.number(),
    }),
  ),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
