import { PageHeader } from "@/components/page-header";

import { WorkflowsClient } from "./workflows-client";

export default function WorkflowsPage() {
  return (
    <main className="page">
      <PageHeader
        eyebrow="Flowstate / Workflows"
        title="Automate extraction decisions with reusable workflows."
        description="Define document type, confidence thresholds, and optional webhook targets, then run on any uploaded artifact."
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/flow-builder", label: "Flow Builder v2" },
          { href: "/upload", label: "Upload" },
          { href: "/review", label: "Review Queue" },
        ]}
      />

      <WorkflowsClient />
    </main>
  );
}
