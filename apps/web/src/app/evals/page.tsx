import { PageHeader } from "@/components/page-header";

import { EvalsClient } from "./evals-client";

export default function EvalsPage() {
  return (
    <main className="page">
      <PageHeader
        title="Evals"
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/review", label: "Review" },
        ]}
      />

      <EvalsClient />
    </main>
  );
}
