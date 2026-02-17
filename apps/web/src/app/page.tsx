import Link from "next/link";

import { DashboardMetrics } from "./dashboard-metrics";

const capabilities = [
  "Upload pipeline for image/PDF artifacts",
  "Invoice + receipt extraction templates",
  "Validation engine (totals + required fields)",
  "Human review queue with approve/reject",
  "CSV export and webhook delivery",
  "Edge adapter bundle generation for deployment runtimes",
  "Evaluation runs for extraction quality baselines",
  "Organization-level tenancy controls across workflow modules",
];

export default function HomePage() {
  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Flowstate</p>
        <h1>OpenAI-native VisionOps platform.</h1>
        <p className="subtitle">
          Build extraction, validation, and human review workflows without managing CV training stacks.
        </p>
        <div className="link-row">
          <Link href="/upload">Start Uploading</Link>
          <Link href="/review">Open Review Queue</Link>
          <Link href="/workflows">Workflow Builder</Link>
          <Link href="/flow-builder">Flow Builder v2</Link>
          <Link href="/edge">Edge Adapters</Link>
          <Link href="/edge-control">Edge Control v2</Link>
          <Link href="/evals">Evals</Link>
          <Link href="/organizations">Organizations</Link>
          <a href="/api/v1/exports/csv?reviewStatus=approved">Export Approved CSV</a>
          <a href="/api/v1/drift">Drift API</a>
          <a href="/api/v1/active-learning/candidates">Active Learning Candidates</a>
        </div>
      </section>

      <section className="panel">
        <h2>Phase 1 Delivered</h2>
        <div className="grid">
          {capabilities.map((item) => (
            <article key={item} className="card">
              <h3>{item}</h3>
            </article>
          ))}
        </div>
      </section>

      <DashboardMetrics />
    </main>
  );
}
