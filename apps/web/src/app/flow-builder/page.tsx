import { PageHeader } from "@/components/page-header";

import { FlowBuilderClient } from "./flow-builder-client";

export default function FlowBuilderPage() {
  return (
    <main className="page">
      <PageHeader
        eyebrow="Flowstate / Flow Builder v2"
        title="Build, version, deploy, and test visual CV pipelines."
        description="This is the Milestone 2 control-plane surface for no-code flow graph authoring on top of OpenAI-native runtime APIs."
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/workflows", label: "Legacy Workflows" },
          { href: "/organizations", label: "Organizations" },
        ]}
      />

      <FlowBuilderClient />
    </main>
  );
}
