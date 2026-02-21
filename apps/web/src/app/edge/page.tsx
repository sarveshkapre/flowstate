import { PageHeader } from "@/components/page-header";

import { EdgeBundlesClient } from "./edge-bundles-client";

export default function EdgePage() {
  return (
    <main className="page">
      <PageHeader
        eyebrow="Flowstate / Edge Adapters"
        title="Package workflows for edge runtimes."
        description="Generate adapter-specific manifests for Cloudflare Workers, Vercel Edge Functions, and browser WASM clients."
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/workflows", label: "Workflow Builder" },
          { href: "/edge-control", label: "Edge Control v2" },
          { href: "/review", label: "Review Queue" },
        ]}
      />

      <EdgeBundlesClient />
    </main>
  );
}
