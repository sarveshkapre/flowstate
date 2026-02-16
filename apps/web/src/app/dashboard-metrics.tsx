"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch("/api/v1/metrics", {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { summary: Summary };
        setSummary(payload.summary ?? defaultSummary);
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
      <h2>Live Metrics</h2>
      <div className="grid">
        <article className="card">
          <h3>Total Jobs</h3>
          <p className="metric">{summary.jobs}</p>
        </article>
        <article className="card">
          <h3>Pending Review</h3>
          <p className="metric">{summary.pending_review}</p>
        </article>
        <article className="card">
          <h3>Avg Confidence</h3>
          <p className="metric">{summary.avg_confidence}</p>
        </article>
        <article className="card">
          <h3>Invalid Results</h3>
          <p className="metric">{summary.invalid_count}</p>
        </article>
        <article className="card">
          <h3>Invoices / Receipts</h3>
          <p className="metric">
            {summary.by_document_type.invoice} / {summary.by_document_type.receipt}
          </p>
        </article>
      </div>
    </section>
  );
}
