import Link from "next/link";

import { WorkflowsClient } from "./workflows-client";

export default function WorkflowsPage() {
  return (
    <main className="page">
      <header className="hero compact">
        <p className="eyebrow">Flowstate / Workflows</p>
        <h1>Automate extraction decisions with reusable workflows.</h1>
        <p className="subtitle">
          Define document type, confidence thresholds, and optional webhook targets, then run on any uploaded artifact.
        </p>
        <div className="link-row">
          <Link href="/">Dashboard</Link>
          <Link href="/flow-builder">Flow Builder v2</Link>
          <Link href="/upload">Upload</Link>
          <Link href="/review">Review Queue</Link>
        </div>
      </header>

      <WorkflowsClient />
    </main>
  );
}
