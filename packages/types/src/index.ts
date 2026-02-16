import { z } from "zod";

export const documentTypeSchema = z.enum(["receipt", "invoice"]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unit_price: z.number(),
  amount: z.number(),
});

export const receiptExtractionSchema = z.object({
  vendor: z.string(),
  date: z.string(),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
  currency: z.string(),
  payment_method: z.string().optional(),
  card_last4: z.string().optional(),
  line_items: z.array(lineItemSchema),
});

export const invoiceExtractionSchema = z.object({
  vendor: z.string(),
  invoice_number: z.string(),
  invoice_date: z.string(),
  due_date: z.string(),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
  currency: z.string(),
  line_items: z.array(lineItemSchema),
});

export const extractionByDocumentSchema = {
  receipt: receiptExtractionSchema,
  invoice: invoiceExtractionSchema,
} as const;

export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;
export type InvoiceExtraction = z.infer<typeof invoiceExtractionSchema>;
export type ExtractionResult = ReceiptExtraction | InvoiceExtraction;

export const extractionJobStatusSchema = z.enum(["queued", "processing", "completed", "failed"]);
export type ExtractionJobStatus = z.infer<typeof extractionJobStatusSchema>;

export const reviewStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const validationIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(["warning", "error"]),
});

export const validationResultSchema = z.object({
  is_valid: z.boolean(),
  confidence: z.number().min(0).max(1),
  issues: z.array(validationIssueSchema),
});

export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type ValidationResult = z.infer<typeof validationResultSchema>;

export const artifactRecordSchema = z.object({
  id: z.string(),
  original_name: z.string(),
  stored_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  created_at: z.string(),
});

export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;

export const extractionJobRecordSchema = z.object({
  id: z.string(),
  artifact_id: z.string(),
  document_type: documentTypeSchema,
  status: extractionJobStatusSchema,
  review_status: reviewStatusSchema,
  reviewer: z.string().nullable(),
  review_notes: z.string().nullable(),
  result: z.unknown().nullable(),
  validation: validationResultSchema.nullable(),
  error_message: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ExtractionJobRecord = z.infer<typeof extractionJobRecordSchema>;

export const auditEventTypeSchema = z.enum([
  "job_created",
  "job_processing",
  "job_completed",
  "job_failed",
  "review_assigned",
  "review_decision",
  "webhook_dispatched",
]);
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

export const auditEventRecordSchema = z.object({
  id: z.string(),
  job_id: z.string().nullable(),
  event_type: auditEventTypeSchema,
  actor: z.string().nullable(),
  metadata: z.unknown().nullable(),
  created_at: z.string(),
});

export type AuditEventRecord = z.infer<typeof auditEventRecordSchema>;

export const webhookDeliveryRecordSchema = z.object({
  id: z.string(),
  target_url: z.string(),
  payload_size_bytes: z.number().int().nonnegative(),
  success: z.boolean(),
  status_code: z.number().int().nullable(),
  response_body: z.string().nullable(),
  created_at: z.string(),
});

export type WebhookDeliveryRecord = z.infer<typeof webhookDeliveryRecordSchema>;

export const datasetSnapshotRecordSchema = z.object({
  id: z.string(),
  review_status: reviewStatusSchema,
  item_count: z.number().int().nonnegative(),
  file_name: z.string(),
  created_at: z.string(),
});

export type DatasetSnapshotRecord = z.infer<typeof datasetSnapshotRecordSchema>;
