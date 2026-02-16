import type { ExtractionJobRecord } from "@flowstate/types";

function escapeCsv(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const escaped = raw.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function extractionJobsToCsv(jobs: ExtractionJobRecord[]): string {
  const headers = [
    "job_id",
    "artifact_id",
    "document_type",
    "status",
    "review_status",
    "confidence",
    "is_valid",
    "result_json",
    "issues_json",
    "reviewer",
    "review_notes",
    "created_at",
    "updated_at",
  ];

  const rows = jobs.map((job) => {
    const confidence = job.validation?.confidence ?? "";
    const isValid = job.validation?.is_valid ?? "";
    const issues = job.validation?.issues ?? [];

    return [
      job.id,
      job.artifact_id,
      job.document_type,
      job.status,
      job.review_status,
      confidence,
      isValid,
      JSON.stringify(job.result ?? {}),
      JSON.stringify(issues),
      job.reviewer ?? "",
      job.review_notes ?? "",
      job.created_at,
      job.updated_at,
    ]
      .map(escapeCsv)
      .join(",");
  });

  return [headers.map(escapeCsv).join(","), ...rows].join("\n");
}
