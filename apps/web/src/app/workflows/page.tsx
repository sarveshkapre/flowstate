import { PageHeader } from "@/components/page-header";

import { WorkflowsClient } from "./workflows-client";

export default function WorkflowsPage() {
  return (
    <main className="page">
      <PageHeader
        title="Workflows"
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/flow-builder", label: "Builder" },
        ]}
      />

      <WorkflowsClient />
    </main>
  );
}
