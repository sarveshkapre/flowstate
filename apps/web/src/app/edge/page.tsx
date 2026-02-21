import { PageHeader } from "@/components/page-header";

import { EdgeBundlesClient } from "./edge-bundles-client";

export default function EdgePage() {
  return (
    <main className="page">
      <PageHeader
        title="Edge Bundles"
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/edge-control", label: "Agents" },
        ]}
      />

      <EdgeBundlesClient />
    </main>
  );
}
