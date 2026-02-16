import type { DocumentType } from "@flowstate/types";

type ExtractionTemplate = {
  schemaName: string;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: {
    type: "object";
    additionalProperties: boolean;
    properties: Record<string, unknown>;
    required: string[];
  };
};

const lineItemSchema = {
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
};

export const extractionTemplates: Record<DocumentType, ExtractionTemplate> = {
  receipt: {
    schemaName: "receipt_extraction",
    systemPrompt:
      "You are a strict receipt parser. Return only JSON that follows the schema. Never include markdown.",
    userPrompt:
      "Extract receipt fields including vendor, date, subtotal, tax, total, currency, line_items, payment_method, and card_last4.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        vendor: { type: "string" },
        date: { type: "string" },
        subtotal: { type: "number" },
        tax: { type: "number" },
        total: { type: "number" },
        currency: { type: "string" },
        payment_method: { type: "string" },
        card_last4: { type: "string" },
        line_items: lineItemSchema,
      },
      required: ["vendor", "date", "subtotal", "tax", "total", "currency", "line_items"],
    },
  },
  invoice: {
    schemaName: "invoice_extraction",
    systemPrompt:
      "You are a strict invoice parser. Return only JSON that follows the schema. Never include markdown.",
    userPrompt:
      "Extract invoice fields including vendor, invoice_number, invoice_date, due_date, subtotal, tax, total, currency, and line_items.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        vendor: { type: "string" },
        invoice_number: { type: "string" },
        invoice_date: { type: "string" },
        due_date: { type: "string" },
        subtotal: { type: "number" },
        tax: { type: "number" },
        total: { type: "number" },
        currency: { type: "string" },
        line_items: lineItemSchema,
      },
      required: [
        "vendor",
        "invoice_number",
        "invoice_date",
        "due_date",
        "subtotal",
        "tax",
        "total",
        "currency",
        "line_items",
      ],
    },
  },
};
