import { PageHeader } from "@/components/page-header";

import { FlowBuilderClient } from "./flow-builder-client";

export default function FlowBuilderPage() {
  return (
    <main className="page">
      <PageHeader
        title="Builder"
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/workflows", label: "Workflows" },
        ]}
      />

      <FlowBuilderClient />
    </main>
  );
}
