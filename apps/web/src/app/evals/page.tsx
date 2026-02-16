import Link from "next/link";

import { EvalsClient } from "./evals-client";

export default function EvalsPage() {
  return (
    <main className="page">
      <header className="hero compact">
        <p className="eyebrow">Flowstate / Evals</p>
        <h1>Benchmark extraction quality over reviewed samples.</h1>
        <p className="subtitle">
          Run lightweight evaluations across approved or rejected jobs to track confidence, field coverage, and issue rates.
        </p>
        <div className="link-row">
          <Link href="/">Dashboard</Link>
          <Link href="/review">Review Queue</Link>
          <Link href="/workflows">Workflow Builder</Link>
          <Link href="/edge">Edge Adapters</Link>
        </div>
      </header>

      <EvalsClient />
    </main>
  );
}
