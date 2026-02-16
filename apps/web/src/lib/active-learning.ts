import type { ExtractionJobRecord } from "@flowstate/types";

export function selectActiveLearningCandidates(
  jobs: ExtractionJobRecord[],
  options?: {
    max?: number;
    confidenceThreshold?: number;
  },
): ExtractionJobRecord[] {
  const max = options?.max ?? 100;
  const threshold = options?.confidenceThreshold ?? 0.78;

  const candidates = jobs.filter((job) => {
    if (job.status !== "completed") {
      return false;
    }

    if (job.review_status === "rejected") {
      return true;
    }

    if (job.validation && job.validation.confidence < threshold) {
      return true;
    }

    if (job.validation && !job.validation.is_valid) {
      return true;
    }

    return false;
  });

  return candidates.slice(0, max);
}
