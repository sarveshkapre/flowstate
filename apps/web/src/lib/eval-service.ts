import type { ExtractionJobRecord, ReviewStatus } from "@flowstate/types";

import { createEvalRunRecord, listEvalRuns, listExtractionJobs } from "@/lib/data-store";
import { extractionTemplates } from "@/lib/extraction-templates";

function isFieldPresent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function computeFieldCoverage(job: ExtractionJobRecord): number {
  const requiredFields = extractionTemplates[job.document_type].jsonSchema.required;

  if (!job.result || typeof job.result !== "object") {
    return 0;
  }

  const candidate = job.result as Record<string, unknown>;
  const present = requiredFields.filter((field) => isFieldPresent(candidate[field])).length;

  return requiredFields.length > 0 ? present / requiredFields.length : 0;
}

export async function runEvaluation(input: {
  reviewStatus: ReviewStatus;
  sampleLimit: number;
}) {
  const jobs = await listExtractionJobs({
    status: "completed",
    reviewStatus: input.reviewStatus,
  });

  const sample = jobs.slice(0, input.sampleLimit);

  const totals = sample.reduce(
    (acc, job) => {
      const confidence = job.validation?.confidence ?? 0;
      const coverage = computeFieldCoverage(job);
      const errorCount = job.validation?.issues.filter((issue) => issue.severity === "error").length ?? 0;
      const warningCount = job.validation?.issues.filter((issue) => issue.severity === "warning").length ?? 0;

      return {
        confidence: acc.confidence + confidence,
        fieldCoverage: acc.fieldCoverage + coverage,
        errorJobs: acc.errorJobs + (errorCount > 0 ? 1 : 0),
        warningJobs: acc.warningJobs + (warningCount > 0 ? 1 : 0),
      };
    },
    { confidence: 0, fieldCoverage: 0, errorJobs: 0, warningJobs: 0 },
  );

  const sampleCount = sample.length;
  const safeDivisor = sampleCount > 0 ? sampleCount : 1;

  const run = await createEvalRunRecord({
    reviewStatus: input.reviewStatus,
    sampleLimit: input.sampleLimit,
    sampleCount,
    avgConfidence: totals.confidence / safeDivisor,
    avgFieldCoverage: totals.fieldCoverage / safeDivisor,
    errorRate: totals.errorJobs / safeDivisor,
    warningRate: totals.warningJobs / safeDivisor,
  });

  return {
    run,
    sampledJobIds: sample.map((job) => job.id),
  };
}

export async function getEvaluationRuns(input?: {
  reviewStatus?: ReviewStatus;
  limit?: number;
}) {
  return listEvalRuns(input);
}
