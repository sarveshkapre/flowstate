import { PageHeader } from "@/components/page-header";

import { EvalsClient } from "./evals-client";

export default function EvalsPage() {
  return (
    <main className="page">
      <PageHeader
        eyebrow="Flowstate / Evals"
        title="Benchmark extraction quality over reviewed samples."
        description="Run lightweight evaluations across approved or rejected jobs to track confidence, field coverage, and issue rates."
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/review", label: "Review Queue" },
          { href: "/workflows", label: "Workflow Builder" },
          { href: "/edge", label: "Edge Adapters" },
        ]}
      />

      <EvalsClient />
    </main>
  );
}
