import type { ExtractionJobRecord } from "@flowstate/types";

type ConfidencePoint = {
  day: string;
  avg_confidence: number;
  count: number;
};

type IssueFrequency = {
  code: string;
  count: number;
};

export function computeDriftInsights(jobs: ExtractionJobRecord[], days = 14): {
  confidence_trend: ConfidencePoint[];
  issue_frequency: IssueFrequency[];
} {
  const recent = jobs
    .filter((job) => job.status === "completed")
    .filter((job) => {
      const ms = Date.parse(job.updated_at);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      return Number.isFinite(ms) && ms >= cutoff;
    });

  const confidenceBuckets = new Map<string, { sum: number; count: number }>();
  const issueCount = new Map<string, number>();

  for (const job of recent) {
    const day = job.updated_at.slice(0, 10);

    if (job.validation) {
      const bucket = confidenceBuckets.get(day) ?? { sum: 0, count: 0 };
      bucket.sum += job.validation.confidence;
      bucket.count += 1;
      confidenceBuckets.set(day, bucket);

      for (const issue of job.validation.issues) {
        issueCount.set(issue.code, (issueCount.get(issue.code) ?? 0) + 1);
      }
    }
  }

  const confidenceTrend: ConfidencePoint[] = Array.from(confidenceBuckets.entries())
    .map(([day, value]) => ({
      day,
      avg_confidence: Number((value.sum / value.count).toFixed(3)),
      count: value.count,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const issueFrequency: IssueFrequency[] = Array.from(issueCount.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    confidence_trend: confidenceTrend,
    issue_frequency: issueFrequency,
  };
}
