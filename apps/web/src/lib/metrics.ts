import type { ExtractionJobRecord } from "@flowstate/types";

export function summarizeJobs(jobs: ExtractionJobRecord[]) {
  const totals = {
    jobs: jobs.length,
    completed: 0,
    failed: 0,
    pending_review: 0,
    approved: 0,
    rejected: 0,
    avg_confidence: 0,
    invalid_count: 0,
    by_document_type: {
      invoice: 0,
      receipt: 0,
    },
  };

  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const job of jobs) {
    totals.by_document_type[job.document_type] += 1;

    if (job.status === "completed") {
      totals.completed += 1;
    }

    if (job.status === "failed") {
      totals.failed += 1;
    }

    if (job.review_status === "pending") {
      totals.pending_review += 1;
    }

    if (job.review_status === "approved") {
      totals.approved += 1;
    }

    if (job.review_status === "rejected") {
      totals.rejected += 1;
    }

    if (job.validation) {
      confidenceSum += job.validation.confidence;
      confidenceCount += 1;

      if (!job.validation.is_valid) {
        totals.invalid_count += 1;
      }
    }
  }

  totals.avg_confidence = confidenceCount > 0 ? Number((confidenceSum / confidenceCount).toFixed(3)) : 0;

  return totals;
}
