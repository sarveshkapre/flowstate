import { PageHeader } from "@/components/page-header";

import { OrganizationsClient } from "./organizations-client";

export default function OrganizationsPage() {
  return (
    <main className="page">
      <PageHeader
        eyebrow="Flowstate / Organizations"
        title="Manage tenant boundaries."
        description="Create organizations and scope workflow, edge, and evaluation operations by tenant."
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/workflows", label: "Workflow Builder" },
          { href: "/edge", label: "Edge Adapters" },
          { href: "/evals", label: "Evals" },
        ]}
      />

      <OrganizationsClient />
    </main>
  );
}
