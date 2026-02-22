"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Grid2X2, List, Plus, Search, Trash2 } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@shadcn-ui/dialog";
import { Input } from "@shadcn-ui/input";
import { Textarea } from "@shadcn-ui/textarea";

type Flow = {
  id: string;
  name: string;
  description: string | null;
  current_version_id: string | null;
  updated_at: string;
};

type ViewMode = "grid" | "list";

export function ProjectWorkflowsClient({ projectId }: { projectId: string }) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [openCreate, setOpenCreate] = useState(false);
  const [createName, setCreateName] = useState("Detect Backup");
  const [createDescription, setCreateDescription] = useState("Count objects and trigger alerts when threshold is crossed.");
  const [deleteFlow, setDeleteFlow] = useState<Flow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadFlows() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v2/flows?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { flows?: Flow[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load workflows.");
      }
      setFlows(payload.flows ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load workflows.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFlows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const filteredFlows = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) {
      return flows;
    }
    return flows.filter((flow) => {
      return (
        flow.name.toLowerCase().includes(text) ||
        flow.id.toLowerCase().includes(text) ||
        (flow.description ?? "").toLowerCase().includes(text)
      );
    });
  }, [flows, query]);

  async function onCreateFlow() {
    if (!createName.trim()) {
      setError("Workflow name is required.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/v2/flows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: createName.trim(),
          description: createDescription.trim() || undefined,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { flow?: Flow; error?: string };
      if (!response.ok || !payload.flow) {
        throw new Error(payload.error || "Failed to create workflow.");
      }

      setMessage(`Created "${payload.flow.name}".`);
      setOpenCreate(false);
      await loadFlows();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create workflow.");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteFlow() {
    if (!deleteFlow) {
      return;
    }

    if (deleteConfirm.trim() !== deleteFlow.id) {
      setError("Workflow ID does not match.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/v2/flows/${deleteFlow.id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Failed to delete workflow.");
      }

      setDeleteFlow(null);
      setDeleteConfirm("");
      setMessage("Workflow deleted.");
      await loadFlows();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete workflow.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-sm text-muted-foreground">Create, edit, and publish vision automation pipelines.</p>
        </div>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Workflow
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Workflow</DialogTitle>
              <DialogDescription>Start with a simple OpenAI-based vision flow.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label className="space-y-1">
                <span className="text-sm font-medium">Name</span>
                <Input value={createName} onChange={(event) => setCreateName(event.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Description</span>
                <Textarea
                  value={createDescription}
                  onChange={(event) => setCreateDescription(event.target.value)}
                  className="min-h-24"
                />
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenCreate(false)}>
                Cancel
              </Button>
              <Button onClick={() => void onCreateFlow()} disabled={busy}>
                {busy ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <div className="relative min-w-[280px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search workflows" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="flex items-center rounded-md border border-border">
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              className="rounded-none rounded-l-md"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              className="rounded-none rounded-r-md"
              onClick={() => setViewMode("grid")}
            >
              <Grid2X2 className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? <p className="text-sm text-muted-foreground">Loading workflows...</p> : null}
      {!loading && filteredFlows.length === 0 ? <p className="text-sm text-muted-foreground">No workflows yet.</p> : null}

      <div className={viewMode === "grid" ? "grid gap-4 md:grid-cols-2" : "space-y-3"}>
        {filteredFlows.map((flow) => (
          <Card key={flow.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <CardTitle className="text-lg">{flow.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">{flow.id}</p>
                </div>
                <Badge variant={flow.current_version_id ? "secondary" : "outline"}>
                  {flow.current_version_id ? "published" : "draft"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {flow.description || "No description yet."}
              </p>
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded bg-blue-100 px-2 py-1 text-blue-700 dark:bg-blue-950 dark:text-blue-300">Input</span>
                  <span>→</span>
                  <span className="rounded bg-violet-100 px-2 py-1 text-violet-700 dark:bg-violet-950 dark:text-violet-300">Detect</span>
                  <span>→</span>
                  <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Output</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm">
                  <Link href={`/projects/${projectId}/workflows/${flow.id}`}>Open</Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDeleteFlow(flow);
                    setDeleteConfirm("");
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={Boolean(deleteFlow)} onOpenChange={(open) => (!open ? setDeleteFlow(null) : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Workflow</DialogTitle>
            <DialogDescription>
              Type this workflow ID to confirm:
              <span className="mt-1 block font-mono text-sm text-foreground">{deleteFlow?.id}</span>
            </DialogDescription>
          </DialogHeader>
          <Input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder="Workflow ID" />
          <p className="text-sm font-medium text-destructive">This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFlow(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void onDeleteFlow()} disabled={busy}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
