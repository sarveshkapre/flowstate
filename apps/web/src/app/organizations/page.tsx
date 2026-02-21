import { PageHeader } from "@/components/page-header";

import { OrganizationsClient } from "./organizations-client";

export default function OrganizationsPage() {
  return (
    <main className="page">
      <PageHeader
        title="Organizations"
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/workflows", label: "Workflows" },
        ]}
      />

      <OrganizationsClient />
    </main>
  );
}
