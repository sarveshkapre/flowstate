"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, History, Minus, Plus, Sparkles } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent } from "@shadcn-ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@shadcn-ui/dialog";

type Flow = {
  id: string;
  name: string;
  description: string | null;
  current_version_id: string | null;
};

type FlowVersion = {
  id: string;
  version_number: number;
  created_at: string;
};

type FlowDeployment = {
  id: string;
  flow_version_id: string;
  deployment_key: string;
  is_active: boolean;
  created_at: string;
};

type RunRecord = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  error_message: string | null;
};

const DRAFT_GRAPH = {
  nodes: [
    { id: "n_input", type: "source_upload", label: "Input", config: { accept: ["image"] } },
    { id: "n_detect", type: "extract", label: "Detect Boxes", config: { model: "gpt-5.2" } },
    { id: "n_filter", type: "validate", label: "Filter to Zone", config: { zone: "A" } },
    { id: "n_count", type: "classify", label: "Count Boxes", config: { key: "count" } },
    { id: "n_alert", type: "route", label: "Backup Detected", config: { when: "count > 4" } },
    { id: "n_output", type: "sink_webhook", label: "Response", config: { format: "json" } },
  ],
  edges: [
    { id: "e1", source: "n_input", target: "n_detect", condition: null },
    { id: "e2", source: "n_detect", target: "n_filter", condition: null },
    { id: "e3", source: "n_filter", target: "n_count", condition: null },
    { id: "e4", source: "n_count", target: "n_alert", condition: "count > 4" },
    { id: "e5", source: "n_alert", target: "n_output", condition: null },
  ],
} as const;

function latestVersionId(versions: FlowVersion[]) {
  const first = versions[0];
  if (!first) {
    return null;
  }

  let latest = first;
  for (const candidate of versions) {
    if (candidate.version_number > latest.version_number) {
      latest = candidate;
    }
  }

  return latest.id;
}

export function FlowEditorClient({ projectId, flowId }: { projectId: string; flowId: string }) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [versions, setVersions] = useState<FlowVersion[]>([]);
  const [deployments, setDeployments] = useState<FlowDeployment[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeDeployment = useMemo(
    () => deployments.find((deployment) => deployment.is_active) ?? null,
    [deployments],
  );

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const [flowResponse, versionsResponse, deploymentsResponse] = await Promise.all([
        fetch(`/api/v2/flows/${flowId}`, { cache: "no-store" }),
        fetch(`/api/v2/flows/${flowId}/versions`, { cache: "no-store" }),
        fetch(`/api/v2/flows/${flowId}/deploy`, { cache: "no-store" }),
      ]);

      const flowPayload = (await flowResponse.json().catch(() => ({}))) as { flow?: Flow; error?: string };
      const versionsPayload = (await versionsResponse.json().catch(() => ({}))) as {
        versions?: FlowVersion[];
        error?: string;
      };
      const deploymentsPayload = (await deploymentsResponse.json().catch(() => ({}))) as {
        deployments?: FlowDeployment[];
        error?: string;
      };

      if (!flowResponse.ok || !flowPayload.flow) {
        throw new Error(flowPayload.error || "Flow not found.");
      }
      if (!versionsResponse.ok) {
        throw new Error(versionsPayload.error || "Failed to load versions.");
      }
      if (!deploymentsResponse.ok) {
        throw new Error(deploymentsPayload.error || "Failed to load deployments.");
      }

      setFlow(flowPayload.flow);
      setVersions(versionsPayload.versions ?? []);
      setDeployments(deploymentsPayload.deployments ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load editor.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId]);

  async function createDraftVersion() {
    const response = await fetch(`/api/v2/flows/${flowId}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graph: DRAFT_GRAPH }),
    });
    const payload = (await response.json().catch(() => ({}))) as { version?: FlowVersion; error?: string };
    if (!response.ok || !payload.version) {
      throw new Error(payload.error || "Failed to save draft.");
    }
    return payload.version.id;
  }

  async function onSaveDraft() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const versionId = await createDraftVersion();
      await load();
      setMessage(`Saved draft ${versionId.slice(0, 8)}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save draft.");
    } finally {
      setBusy(false);
    }
  }

  async function onPublish() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const currentVersionId = latestVersionId(versions) ?? (await createDraftVersion());
      const response = await fetch(`/api/v2/flows/${flowId}/deploy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flowVersionId: currentVersionId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        deployment?: FlowDeployment;
        error?: string;
      };
      if (!response.ok || !payload.deployment) {
        throw new Error(payload.error || "Failed to publish workflow.");
      }

      await load();
      setMessage(`Published ${payload.deployment.deployment_key.slice(0, 12)}.`);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Failed to publish workflow.");
    } finally {
      setBusy(false);
    }
  }

  const loadRuns = useCallback(async () => {
    const response = await fetch(`/api/v2/runs?projectId=${projectId}&flowId=${flowId}&limit=20`, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { runs?: RunRecord[]; error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load run history.");
    }
    setRuns(payload.runs ?? []);
  }, [projectId, flowId]);

  async function onRunFlow() {
    if (!activeDeployment) {
      setError("Publish a workflow deployment before running.");
      return;
    }

    setRunBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/v2/sources/webhook/${activeDeployment.deployment_key}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "flow-editor",
          flowId,
          timestamp: new Date().toISOString(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        run?: RunRecord;
        error?: string;
      };
      if (!response.ok || !payload.run) {
        throw new Error(payload.error || "Failed to run workflow.");
      }

      await loadRuns();
      setMessage(`Run ${payload.run.id.slice(0, 8)} started (${payload.run.status}).`);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to run workflow.");
    } finally {
      setRunBusy(false);
    }
  }

  useEffect(() => {
    if (!historyOpen) {
      return;
    }

    void loadRuns().catch((historyError) => {
      setError(historyError instanceof Error ? historyError.message : "Failed to load run history.");
    });
  }, [historyOpen, loadRuns]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="icon-sm" variant="ghost" asChild>
            <Link href={`/projects/${projectId}/workflows`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{flow?.name ?? "Workflow"}</p>
            <p className="truncate text-sm text-muted-foreground">{flow?.description || "Serverless API"}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <History className="mr-2 h-4 w-4" />
                History
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Run History</DialogTitle>
                <DialogDescription>Recent workflow runs for this flow.</DialogDescription>
              </DialogHeader>
              <div className="max-h-96 space-y-2 overflow-auto pr-1">
                {runs.length === 0 ? <p className="text-sm text-muted-foreground">No runs yet.</p> : null}
                {runs.map((run) => (
                  <div key={run.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-xs">{run.id}</p>
                      <Badge variant={run.status === "failed" ? "destructive" : "outline"}>{run.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(run.created_at).toLocaleString()}
                    </p>
                    {run.error_message ? (
                      <p className="mt-1 text-xs text-destructive">{run.error_message}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" onClick={() => void onRunFlow()} disabled={runBusy || loading}>
            {runBusy ? "Running..." : "Run"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void onSaveDraft()} disabled={busy || loading}>
            Save Draft
          </Button>
          <Button size="sm" onClick={() => void onPublish()} disabled={busy || loading}>
            Publish
          </Button>
        </div>
      </div>

      <div className="relative rounded-2xl border border-border bg-background">
        <div className="absolute left-3 top-3 z-20 flex flex-col gap-2">
          <Button size="icon-sm" className="rounded-full">
            <Plus className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" variant="outline" className="rounded-full">
            <Sparkles className="h-4 w-4" />
          </Button>
        </div>

        <div
          className="relative h-[780px] overflow-hidden rounded-2xl bg-[radial-gradient(circle,_rgba(148,163,184,0.18)_1px,_transparent_1px)] bg-[size:20px_20px]"
          style={{ backgroundColor: "var(--background)" }}
        >
          <Card className="absolute left-1/2 top-16 w-[230px] -translate-x-1/2 border-border">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Inputs</p>
              <p className="font-medium">image</p>
            </CardContent>
          </Card>

          <Card className="absolute left-1/2 top-56 w-[250px] -translate-x-1/2 border-l-4 border-l-violet-500">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Object Detection Model</p>
              <p className="font-medium">Detect Boxes</p>
            </CardContent>
          </Card>

          <Card className="absolute left-1/2 top-[360px] w-[250px] -translate-x-1/2 border-l-4 border-l-amber-500">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Detection Filter</p>
              <p className="font-medium">Filter to Zone</p>
            </CardContent>
          </Card>

          <Card className="absolute left-[33%] top-[470px] w-[220px] -translate-x-1/2 border-l-4 border-l-blue-500">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Visualization</p>
              <p className="font-medium">Add Bounding Boxes</p>
            </CardContent>
          </Card>

          <Card className="absolute left-[67%] top-[470px] w-[220px] -translate-x-1/2 border-l-4 border-l-orange-500">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Property</p>
              <p className="font-medium">Count Boxes</p>
            </CardContent>
          </Card>

          <Card className="absolute left-1/2 top-[585px] w-[230px] -translate-x-1/2 border-l-4 border-l-emerald-500">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Expression</p>
              <p className="font-medium">Backup Detected</p>
            </CardContent>
          </Card>

          <Card className="absolute bottom-16 left-1/2 w-[240px] -translate-x-1/2 border-border">
            <CardContent className="space-y-2 p-3">
              <p className="text-xs text-muted-foreground">Outputs</p>
              <Badge variant="outline">zone_visualization</Badge>
              <Badge variant="outline">count_boxes</Badge>
              <Badge variant="outline">backup_detected</Badge>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">v{versions[0]?.version_number ?? 0}</Badge>
            {activeDeployment ? <Badge variant="secondary">active deployment</Badge> : <Badge variant="outline">not deployed</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Button size="icon-sm" variant="ghost">
              <Minus className="h-4 w-4" />
            </Button>
            <Button size="icon-sm" variant="ghost">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading editor...</p> : null}
      {message ? (
        <p className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
          <Check className="h-4 w-4" />
          {message}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
