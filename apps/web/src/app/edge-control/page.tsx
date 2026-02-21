import { PageHeader } from "@/components/page-header";

import { EdgeControlClient } from "./edge-control-client";

export default function EdgeControlPage() {
  return (
    <main className="page">
      <PageHeader
        eyebrow="Flowstate / Edge Control v2"
        title="Operate edge agents with config versions and command queue workflows."
        description="Register agents, push config updates, dispatch commands, and track acknowledgements from one control surface."
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/edge", label: "Edge Bundles" },
          { href: "/flow-builder", label: "Flow Builder v2" },
        ]}
      />

      <EdgeControlClient />
    </main>
  );
}
