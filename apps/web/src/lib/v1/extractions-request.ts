import { documentTypeSchema, extractionJobStatusSchema, reviewStatusSchema } from "@flowstate/types";
import { z } from "zod";

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    reviewer: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("review"),
    reviewStatus: z.enum(["approved", "rejected"]),
    reviewer: z.string().trim().min(1).max(120).optional(),
    reviewNotes: z.string().trim().max(4000).optional(),
  }),
]);

export type ExtractionPatchAction = z.infer<typeof patchSchema>;

export function parseExtractionListFilters(searchParams: URLSearchParams) {
  const statusRaw = searchParams.get("status");
  const reviewStatusRaw = searchParams.get("reviewStatus");
  const documentTypeRaw = searchParams.get("documentType");

  const status = statusRaw ? extractionJobStatusSchema.safeParse(statusRaw) : null;
  const reviewStatus = reviewStatusRaw ? reviewStatusSchema.safeParse(reviewStatusRaw) : null;
  const documentType = documentTypeRaw ? documentTypeSchema.safeParse(documentTypeRaw) : null;

  if (statusRaw && !status?.success) {
    return { ok: false as const, error: "Invalid status filter" };
  }

  if (reviewStatusRaw && !reviewStatus?.success) {
    return { ok: false as const, error: "Invalid reviewStatus filter" };
  }

  if (documentTypeRaw && !documentType?.success) {
    return { ok: false as const, error: "Invalid documentType filter" };
  }

  return {
    ok: true as const,
    filters: {
      status: status?.success ? status.data : undefined,
      reviewStatus: reviewStatus?.success ? reviewStatus.data : undefined,
      documentType: documentType?.success ? documentType.data : undefined,
    },
  };
}

export function parseExtractionPatchAction(payload: unknown) {
  return patchSchema.safeParse(payload);
}
