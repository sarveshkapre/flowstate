"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";

type Summary = {
  jobs: number;
  completed: number;
  failed: number;
  pending_review: number;
  approved: number;
  rejected: number;
  avg_confidence: number;
  invalid_count: number;
  by_document_type: {
    invoice: number;
    receipt: number;
  };
};

type DriftPayload = {
  drift: {
    confidence_trend: Array<{ day: string; avg_confidence: number; count: number }>;
    issue_frequency: Array<{ code: string; count: number }>;
  };
};

type EvalRunsPayload = {
  runs: Array<{
    id: string;
    avg_confidence: number;
    avg_field_coverage: number;
    sample_count: number;
    review_status: "pending" | "approved" | "rejected";
  }>;
};

const defaultSummary: Summary = {
  jobs: 0,
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

export function DashboardMetrics() {
  const [summary, setSummary] = useState<Summary>(defaultSummary);
  const [topIssues, setTopIssues] = useState<Array<{ code: string; count: number }>>([]);
  const [latestTrend, setLatestTrend] = useState<{ day: string; avg_confidence: number } | null>(null);
  const [latestEval, setLatestEval] = useState<EvalRunsPayload["runs"][number] | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const [metricsResponse, driftResponse, evalResponse] = await Promise.all([
          fetch("/api/v1/metrics", {
            signal: controller.signal,
            cache: "no-store",
          }),
          fetch("/api/v1/drift", {
            signal: controller.signal,
            cache: "no-store",
          }),
          fetch("/api/v1/evals/runs?limit=1", {
            signal: controller.signal,
            cache: "no-store",
          }),
        ]);

        if (metricsResponse.ok) {
          const payload = (await metricsResponse.json()) as { summary: Summary };
          setSummary(payload.summary ?? defaultSummary);
        }

        if (driftResponse.ok) {
          const payload = (await driftResponse.json()) as DriftPayload;
          setTopIssues(payload.drift.issue_frequency.slice(0, 3));
          const trend = payload.drift.confidence_trend;
          const latest = trend.length ? trend[trend.length - 1] ?? null : null;
          setLatestTrend(latest ? { day: latest.day, avg_confidence: latest.avg_confidence } : null);
        }

        if (evalResponse.ok) {
          const payload = (await evalResponse.json()) as EvalRunsPayload;
          setLatestEval(payload.runs[0] ?? null);
        }
      } catch {
        // Ignore transient errors for dashboard metrics.
      }
    }

    void load();

    return () => {
      controller.abort();
    };
  }, []);

  return (
    <section className="panel">
      <h2>Metrics</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Jobs</CardTitle>
          </CardHeader>
          <CardContent><p className="metric">{summary.jobs}</p></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pending</CardTitle>
          </CardHeader>
          <CardContent><p className="metric">{summary.pending_review}</p></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Confidence</CardTitle>
          </CardHeader>
          <CardContent><p className="metric">{summary.avg_confidence}</p></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Invalid</CardTitle>
          </CardHeader>
          <CardContent><p className="metric">{summary.invalid_count}</p></CardContent>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Invoice / Receipt</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="metric">
              {summary.by_document_type.invoice} / {summary.by_document_type.receipt}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Drift</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="metric">{latestTrend ? latestTrend.avg_confidence : "-"}</p>
            <p className="muted">{latestTrend ? latestTrend.day : "no data"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top Issues</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="muted">
              {topIssues.length ? topIssues.map((issue) => `${issue.code} (${issue.count})`).join(", ") : "none"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Eval</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="metric">{latestEval ? latestEval.avg_field_coverage : "-"}</p>
            <p className="muted">
              {latestEval
                ? `${latestEval.review_status} (${latestEval.sample_count} samples)`
                : "run an eval to populate"}
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
