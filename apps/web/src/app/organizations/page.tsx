import Link from "next/link";

import { OrganizationsClient } from "./organizations-client";

export default function OrganizationsPage() {
  return (
    <main className="page">
      <header className="hero compact">
        <p className="eyebrow">Flowstate / Organizations</p>
        <h1>Manage tenant boundaries.</h1>
        <p className="subtitle">
          Create organizations and scope workflow, edge, and evaluation operations by tenant.
        </p>
        <div className="link-row">
          <Link href="/">Dashboard</Link>
          <Link href="/workflows">Workflow Builder</Link>
          <Link href="/edge">Edge Adapters</Link>
          <Link href="/evals">Evals</Link>
        </div>
      </header>

      <OrganizationsClient />
    </main>
  );
}
