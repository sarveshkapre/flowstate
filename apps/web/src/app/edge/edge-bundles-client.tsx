/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Workflow = {
  id: string;
  organization_id: string;
  name: string;
  document_type: "invoice" | "receipt";
};

type Adapter = {
  id: "cloudflare_worker" | "vercel_edge_function" | "browser_wasm";
  name: string;
  runtime: string;
  description: string;
  supportsWebhookDispatch: boolean;
  supportsAutoApprove: boolean;
};

type Bundle = {
  id: string;
  organization_id: string;
  workflow_id: string;
  workflow_name: string;
  adapter: string;
  runtime: string;
  model: string;
  file_name: string;
  file_size_bytes: number;
  checksum_sha256: string;
  created_at: string;
};

type Organization = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
};

export function EdgeBundlesClient() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>("");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [adapters, setAdapters] = useState<Adapter[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [adapterId, setAdapterId] = useState<Adapter["id"] | "">("");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [manifestPreview, setManifestPreview] = useState<string>("");

  const loadOrganizations = useCallback(async () => {
    const response = await fetch("/api/v1/organizations", { cache: "no-store" });
    const payload = (await response.json()) as { organizations: Organization[] };
    const nextOrganizations = payload.organizations ?? [];
    setOrganizations(nextOrganizations);

    if (!selectedOrganizationId && nextOrganizations[0]) {
      setSelectedOrganizationId(nextOrganizations[0].id);
    }
  }, [selectedOrganizationId]);

  const loadWorkflows = useCallback(async () => {
    const query = selectedOrganizationId
      ? `/api/v1/workflows?organizationId=${encodeURIComponent(selectedOrganizationId)}`
      : "/api/v1/workflows";
    const response = await fetch(query, { cache: "no-store" });
    const payload = (await response.json()) as { workflows: Workflow[] };
    const nextWorkflows = payload.workflows ?? [];

    setWorkflows(nextWorkflows);

    const firstWorkflow = nextWorkflows[0];
    const selectedExists = nextWorkflows.some((workflow) => workflow.id === workflowId);
    if (!selectedExists) {
      setWorkflowId(firstWorkflow?.id ?? "");
    }
  }, [selectedOrganizationId, workflowId]);

  const loadAdapters = useCallback(async () => {
    const response = await fetch("/api/v1/edge/adapters", { cache: "no-store" });
    const payload = (await response.json()) as { adapters: Adapter[] };
    const nextAdapters = payload.adapters ?? [];

    setAdapters(nextAdapters);

    if (!adapterId && nextAdapters[0]) {
      setAdapterId(nextAdapters[0].id);
    }
  }, [adapterId]);

  const loadBundles = useCallback(async () => {
    const query = selectedOrganizationId
      ? `/api/v1/edge/bundles?organizationId=${encodeURIComponent(selectedOrganizationId)}&limit=50`
      : "/api/v1/edge/bundles?limit=50";
    const response = await fetch(query, { cache: "no-store" });
    const payload = (await response.json()) as { bundles: Bundle[] };
    setBundles(payload.bundles ?? []);
  }, [selectedOrganizationId]);

  useEffect(() => {
    void loadOrganizations();
    void loadWorkflows();
    void loadAdapters();
    void loadBundles();
  }, [loadAdapters, loadBundles, loadOrganizations, loadWorkflows]);

  const selectedAdapter = useMemo(() => adapters.find((item) => item.id === adapterId) ?? null, [adapterId, adapters]);

  async function createBundle() {
    if (!workflowId || !adapterId) {
      setStatusMessage("Choose a workflow and adapter.");
      return;
    }

    setStatusMessage(null);

    const response = await fetch("/api/v1/edge/bundles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowId,
        adapterId,
        model: model.trim() || undefined,
      }),
    });

    const payload = (await response.json()) as {
      bundle?: Bundle;
      manifest?: unknown;
      error?: string;
    };

    if (!response.ok || !payload.bundle) {
      setStatusMessage(payload.error || "Failed to create edge bundle.");
      return;
    }

    setStatusMessage(`Bundle created: ${payload.bundle.file_name}`);
    setManifestPreview(JSON.stringify(payload.manifest ?? {}, null, 2));
    await loadBundles();
  }

  return (
    <section className="panel stack">
      <h2>Edge Bundle Generator</h2>
      <p className="muted">Build and download adapter manifests that can run OpenAI extraction workflows at the edge.</p>

      <div className="grid two-col">
        <article className="card stack">
          <h3>Create Bundle</h3>

          <label className="field">
            <span>Organization</span>
            <select value={selectedOrganizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)}>
              <option value="">Select organization</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Workflow</span>
            <select value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>
              <option value="">Select workflow</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name} ({workflow.document_type})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Adapter</span>
            <select value={adapterId} onChange={(event) => setAdapterId(event.target.value as Adapter["id"])}>
              <option value="">Select adapter</option>
              {adapters.map((adapter) => (
                <option key={adapter.id} value={adapter.id}>
                  {adapter.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>OpenAI Model</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-4.1-mini" />
          </label>

          <button className="button" onClick={() => void createBundle()}>
            Generate Edge Bundle
          </button>

          {selectedAdapter && (
            <p className="muted">
              runtime: {selectedAdapter.runtime} • webhook support: {String(selectedAdapter.supportsWebhookDispatch)}
            </p>
          )}

          {selectedAdapter && <p className="muted">{selectedAdapter.description}</p>}
          {statusMessage && <p className="muted">{statusMessage}</p>}
        </article>

        <article className="card stack">
          <h3>Manifest Preview</h3>
          {!manifestPreview && <p className="muted">Generate a bundle to preview its manifest.</p>}
          {manifestPreview && <pre className="json small">{manifestPreview}</pre>}
        </article>
      </div>

      <div className="divider" />
      <h3>Recent Bundles</h3>
      <div className="stack">
        {bundles.length === 0 && <p className="muted">No bundles generated yet.</p>}
        {bundles.map((bundle) => (
          <article key={bundle.id} className="job-card stack">
            <p className="mono">{bundle.file_name}</p>
            <p className="muted">
              workflow: {bundle.workflow_name} • adapter: {bundle.adapter} • runtime: {bundle.runtime}
            </p>
            <p className="muted">
              model: {bundle.model} • size: {bundle.file_size_bytes} bytes
            </p>
            <p className="mono">sha256: {bundle.checksum_sha256}</p>
            <div className="row wrap">
              <a href={`/api/v1/edge/bundles/${bundle.id}/download`} className="button secondary">
                Download JSON
              </a>
              <span className="muted">created: {bundle.created_at}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
