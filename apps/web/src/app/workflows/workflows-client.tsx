/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  document_type: "invoice" | "receipt";
  is_active: boolean;
  min_confidence_auto_approve: number;
  webhook_url: string | null;
};

type WorkflowRun = {
  id: string;
  workflow_id: string;
  artifact_id: string;
  extraction_job_id: string | null;
  status: string;
  auto_review_applied: boolean;
  error_message: string | null;
  updated_at: string;
};

type Artifact = {
  id: string;
  original_name: string;
  mime_type: string;
};

export function WorkflowsClient() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [artifactId, setArtifactId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [name, setName] = useState("Invoice Fastlane");
  const [description, setDescription] = useState("Auto-approve high-confidence invoice extracts.");
  const [documentType, setDocumentType] = useState<"invoice" | "receipt">("invoice");
  const [threshold, setThreshold] = useState(0.92);
  const [webhookUrl, setWebhookUrl] = useState("");

  const loadWorkflows = useCallback(async () => {
    const response = await fetch("/api/v1/workflows", { cache: "no-store" });
    const payload = (await response.json()) as { workflows: Workflow[] };
    setWorkflows(payload.workflows ?? []);

    const firstWorkflow = payload.workflows?.[0];
    if (!selectedWorkflowId && firstWorkflow) {
      setSelectedWorkflowId(firstWorkflow.id);
    }
  }, [selectedWorkflowId]);

  const loadArtifacts = useCallback(async () => {
    const response = await fetch("/api/v1/uploads?limit=100", { cache: "no-store" });
    const payload = (await response.json()) as { artifacts: Artifact[] };
    setArtifacts(payload.artifacts ?? []);

    const firstArtifact = payload.artifacts?.[0];
    if (!artifactId && firstArtifact) {
      setArtifactId(firstArtifact.id);
    }
  }, [artifactId]);

  const loadRuns = useCallback(async (workflowId: string) => {
    if (!workflowId) {
      setWorkflowRuns([]);
      return;
    }

    const response = await fetch(`/api/v1/workflows/${workflowId}/runs`, { cache: "no-store" });
    const payload = (await response.json()) as { runs: WorkflowRun[] };
    setWorkflowRuns(payload.runs ?? []);
  }, []);

  useEffect(() => {
    void loadWorkflows();
    void loadArtifacts();
  }, [loadArtifacts, loadWorkflows]);

  useEffect(() => {
    void loadRuns(selectedWorkflowId);
  }, [loadRuns, selectedWorkflowId]);

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [workflows, selectedWorkflowId],
  );

  async function createWorkflow() {
    setStatusMessage(null);

    const response = await fetch("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        description,
        documentType,
        minConfidenceAutoApprove: threshold,
        webhookUrl: webhookUrl.trim() || undefined,
        isActive: true,
      }),
    });

    const payload = (await response.json()) as {
      workflow?: Workflow;
      error?: string;
    };

    if (!response.ok || !payload.workflow) {
      setStatusMessage(payload.error || "Failed to create workflow.");
      return;
    }

    setStatusMessage(`Workflow created: ${payload.workflow.name}`);
    await loadWorkflows();
    setSelectedWorkflowId(payload.workflow.id);
  }

  async function runSelectedWorkflow() {
    if (!selectedWorkflowId || !artifactId) {
      setStatusMessage("Select a workflow and artifact.");
      return;
    }

    setStatusMessage(null);

    const response = await fetch(`/api/v1/workflows/${selectedWorkflowId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifactId }),
    });

    const payload = (await response.json()) as {
      run?: WorkflowRun;
      extractionJob?: { id: string };
      error?: string;
    };

    if (!response.ok || !payload.run) {
      setStatusMessage(payload.error || "Failed to run workflow.");
      return;
    }

    setStatusMessage(`Workflow run completed (${payload.run.status}). Extraction job: ${payload.extractionJob?.id ?? "-"}`);
    await loadRuns(selectedWorkflowId);
  }

  return (
    <section className="panel stack">
      <h2>Workflow Builder</h2>
      <p className="muted">Create and run deterministic extraction workflows over uploaded artifacts.</p>

      <div className="grid two-col">
        <article className="card stack">
          <h3>Create Workflow</h3>

          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label className="field">
            <span>Description</span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>

          <label className="field">
            <span>Document Type</span>
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value as "invoice" | "receipt")}>
              <option value="invoice">Invoice</option>
              <option value="receipt">Receipt</option>
            </select>
          </label>

          <label className="field">
            <span>Auto-Approve Confidence Threshold</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
            />
          </label>

          <label className="field">
            <span>Optional Webhook URL</span>
            <input
              placeholder="https://example.com/webhook"
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
            />
          </label>

          <button className="button" onClick={() => void createWorkflow()}>
            Create Workflow
          </button>
        </article>

        <article className="card stack">
          <h3>Run Workflow</h3>

          <label className="field">
            <span>Workflow</span>
            <select value={selectedWorkflowId} onChange={(event) => setSelectedWorkflowId(event.target.value)}>
              <option value="">Select workflow</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Artifact</span>
            <select value={artifactId} onChange={(event) => setArtifactId(event.target.value)}>
              <option value="">Select artifact</option>
              {artifacts.map((artifact) => (
                <option key={artifact.id} value={artifact.id}>
                  {artifact.original_name}
                </option>
              ))}
            </select>
          </label>

          <button className="button" onClick={() => void runSelectedWorkflow()}>
            Run Workflow
          </button>

          {selectedWorkflow && (
            <p className="muted">
              {selectedWorkflow.document_type} • auto-approve {selectedWorkflow.min_confidence_auto_approve}
            </p>
          )}
        </article>
      </div>

      {statusMessage && <p className="muted">{statusMessage}</p>}

      <div className="divider" />
      <h3>Recent Runs</h3>
      <div className="stack">
        {workflowRuns.length === 0 && <p className="muted">No runs yet for selected workflow.</p>}
        {workflowRuns.map((run) => (
          <article key={run.id} className="job-card">
            <p className="mono">Run {run.id.slice(0, 8)}</p>
            <p className="muted">
              status: {run.status} • auto-review: {String(run.auto_review_applied)} • updated: {run.updated_at}
            </p>
            <p className="muted">job: {run.extraction_job_id ?? "-"}</p>
            {run.error_message && <p className="error">{run.error_message}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
