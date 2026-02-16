import {
  extractionByDocumentSchema,
  type DocumentType,
  type ValidationIssue,
  type ValidationResult,
  validationResultSchema,
} from "@flowstate/types";

function hasValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function validateExtraction(documentType: DocumentType, payload: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  const parsed = extractionByDocumentSchema[documentType].safeParse(payload);

  if (!parsed.success) {
    return {
      is_valid: false,
      confidence: 0,
      issues: [
        {
          code: "schema_invalid",
          message: "Extraction payload does not match expected schema.",
          severity: "error",
        },
      ],
    };
  }

  const data = parsed.data as Record<string, unknown>;

  const requiredStringFields =
    documentType === "invoice"
      ? ["vendor", "invoice_number", "invoice_date", "due_date", "currency"]
      : ["vendor", "date", "currency"];

  for (const field of requiredStringFields) {
    if (!hasValue(data[field])) {
      issues.push({
        code: `missing_${field}`,
        message: `${field} is missing or empty.`,
        severity: "error",
      });
    }
  }

  const subtotal = asNumber(data.subtotal);
  const tax = asNumber(data.tax);
  const total = asNumber(data.total);

  if (subtotal === null || tax === null || total === null) {
    issues.push({
      code: "numeric_fields_missing",
      message: "subtotal, tax, and total must be valid numeric values.",
      severity: "error",
    });
  }

  const lineItems = Array.isArray(data.line_items)
    ? data.line_items.filter((item): item is { amount: number } => {
        return (
          typeof item === "object" &&
          item !== null &&
          typeof (item as { amount?: unknown }).amount === "number"
        );
      })
    : [];

  if (lineItems.length === 0) {
    issues.push({
      code: "line_items_empty",
      message: "No valid line_items were extracted.",
      severity: "error",
    });
  }

  if (subtotal !== null && tax !== null && total !== null) {
    const lineItemsTotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
    const subtotalDelta = Math.abs(lineItemsTotal - subtotal);
    const totalDelta = Math.abs(subtotal + tax - total);

    if (subtotalDelta > 0.02) {
      issues.push({
        code: "subtotal_mismatch",
        message: `Line item sum (${lineItemsTotal.toFixed(2)}) differs from subtotal (${subtotal.toFixed(2)}).`,
        severity: "warning",
      });
    }

    if (totalDelta > 0.02) {
      issues.push({
        code: "total_mismatch",
        message: `Subtotal + tax (${(subtotal + tax).toFixed(2)}) differs from total (${total.toFixed(2)}).`,
        severity: "error",
      });
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.length - errorCount;

  const rawConfidence = 0.96 - errorCount * 0.24 - warningCount * 0.1;
  const confidence = Math.max(0.01, Math.min(0.99, Number(rawConfidence.toFixed(2))));

  const result = {
    is_valid: errorCount === 0,
    confidence,
    issues,
  };

  return validationResultSchema.parse(result);
}
