/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@flowstate/ui";

type Organization = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

export function OrganizationsClient() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [name, setName] = useState("Acme Ops");
  const [slug, setSlug] = useState("acme-ops");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadOrganizations = useCallback(async () => {
    const response = await fetch("/api/v1/organizations", { cache: "no-store" });
    const payload = (await response.json()) as { organizations: Organization[] };
    setOrganizations(payload.organizations ?? []);
  }, []);

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  async function createOrganization() {
    setStatusMessage(null);

    const response = await fetch("/api/v1/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        slug: slug.trim() || undefined,
      }),
    });

    const payload = (await response.json()) as {
      organization?: Organization;
      error?: string;
    };

    if (!response.ok || !payload.organization) {
      setStatusMessage(payload.error || "Failed to create organization.");
      return;
    }

    setStatusMessage(`Organization created: ${payload.organization.name}`);
    await loadOrganizations();
  }

  return (
    <section className="panel stack">
      <h2>Organizations</h2>
      <p className="muted">Use organizations to isolate workflow and deployment operations by tenant.</p>

      <Card className="stack">
        <CardHeader>
          <CardTitle>Create Organization</CardTitle>
        </CardHeader>
        <CardContent className="stack">

          <label className="field small">
            <span>Name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label className="field small">
            <span>Slug</span>
            <Input value={slug} onChange={(event) => setSlug(event.target.value)} />
          </label>

          <Button onClick={() => void createOrganization()}>Create Organization</Button>

          {statusMessage && <p className="muted">{statusMessage}</p>}
        </CardContent>
      </Card>

      <div className="divider" />
      <h3>Current Organizations</h3>
      <div className="stack">
        {organizations.length === 0 && <p className="muted">No organizations found.</p>}
        {organizations.map((organization) => (
          <Card key={organization.id}>
            <CardContent className="stack pt-5">
              <p className="mono">{organization.name}</p>
              <p className="muted">slug: {organization.slug}</p>
              <p className="muted">active: {String(organization.is_active)}</p>
              <p className="muted">created: {organization.created_at}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
