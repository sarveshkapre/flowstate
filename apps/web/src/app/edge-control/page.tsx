import { PageHeader } from "@/components/page-header";

import { EdgeControlClient } from "./edge-control-client";

export default function EdgeControlPage() {
  return (
    <main className="page">
      <PageHeader
        title="Agents"
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/edge", label: "Edge" },
        ]}
      />

      <EdgeControlClient />
    </main>
  );
}
