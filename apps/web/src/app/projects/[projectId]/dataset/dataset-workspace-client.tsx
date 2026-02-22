"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";
import { NativeSelect } from "@shadcn-ui/native-select";
import { Separator } from "@shadcn-ui/separator";

type Dataset = {
  id: string;
  name: string;
  description: string | null;
};

type Batch = {
  id: string;
  name: string;
  status:
    | "uploaded"
    | "preprocessing"
    | "ready_for_label"
    | "in_labeling"
    | "in_review"
    | "approved"
    | "rework"
    | "exported";
  source_type: "image" | "video" | "pdf" | "mixed";
  item_count: number;
  labeled_count: number;
  approved_count: number;
  created_at: string;
};

type DatasetVersion = {
  id: string;
  version_number: number;
  item_count: number;
  created_at: string;
};

export function DatasetWorkspaceClient({ projectId }: { projectId: string }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [versions, setVersions] = useState<DatasetVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyBatchId, setBusyBatchId] = useState<string | null>(null);
  const [busyVersionBuild, setBusyVersionBuild] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDatasets() {
    const response = await fetch(`/api/v2/datasets?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { datasets?: Dataset[]; error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load datasets.");
    }

    const nextDatasets = payload.datasets ?? [];
    setDatasets(nextDatasets);
    const firstDataset = nextDatasets[0];
    if (firstDataset && !nextDatasets.some((dataset) => dataset.id === selectedDatasetId)) {
      setSelectedDatasetId(firstDataset.id);
    }
  }

  async function loadDatasetDetails(datasetId: string) {
    const [batchesResponse, versionsResponse] = await Promise.all([
      fetch(`/api/v2/datasets/${datasetId}/batches?limit=100`, { cache: "no-store" }),
      fetch(`/api/v2/datasets/${datasetId}/versions`, { cache: "no-store" }),
    ]);

    const batchesPayload = (await batchesResponse.json().catch(() => ({}))) as { batches?: Batch[]; error?: string };
    const versionsPayload = (await versionsResponse.json().catch(() => ({}))) as {
      versions?: DatasetVersion[];
      error?: string;
    };

    if (!batchesResponse.ok) {
      throw new Error(batchesPayload.error || "Failed to load batches.");
    }

    if (!versionsResponse.ok) {
      throw new Error(versionsPayload.error || "Failed to load versions.");
    }

    setBatches(batchesPayload.batches ?? []);
    setVersions(versionsPayload.versions ?? []);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        await loadDatasets();
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load dataset workspace.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!selectedDatasetId) {
      setBatches([]);
      setVersions([]);
      return;
    }

    let cancelled = false;
    async function load() {
      try {
        await loadDatasetDetails(selectedDatasetId);
      } catch (detailError) {
        if (!cancelled) {
          setError(detailError instanceof Error ? detailError.message : "Failed to load dataset details.");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedDatasetId]);

  async function updateBatchStatus(batchId: string, status: Batch["status"]) {
    setBusyBatchId(batchId);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/v2/batches/${batchId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update status.");
      }

      if (selectedDatasetId) {
        await loadDatasetDetails(selectedDatasetId);
      }
      setMessage("Batch status updated.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update batch status.");
    } finally {
      setBusyBatchId(null);
    }
  }

  async function buildVersion(batchId?: string) {
    if (!selectedDatasetId) {
      return;
    }

    setBusyVersionBuild(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/v2/datasets/${selectedDatasetId}/versions/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { version?: DatasetVersion; error?: string };
      if (!response.ok || !payload.version) {
        throw new Error(payload.error || "Failed to build version.");
      }

      await loadDatasetDetails(selectedDatasetId);
      setMessage(`Built version v${payload.version.version_number}.`);
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "Failed to build version.");
    } finally {
      setBusyVersionBuild(false);
    }
  }

  const totals = useMemo(() => {
    return batches.reduce(
      (accumulator, batch) => {
        accumulator.assets += batch.item_count;
        accumulator.labeled += batch.labeled_count;
        accumulator.approved += batch.approved_count;
        return accumulator;
      },
      { assets: 0, labeled: 0, approved: 0 },
    );
  }, [batches]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dataset</h1>
          <p className="text-sm text-muted-foreground">Track batches and publish labeled versions.</p>
        </div>
        <Button onClick={() => void buildVersion()} disabled={busyVersionBuild || !selectedDatasetId}>
          {busyVersionBuild ? "Building..." : "Build Version"}
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-center">
          <label className="space-y-1">
            <span className="text-sm font-medium">Dataset</span>
            <NativeSelect value={selectedDatasetId} onChange={(event) => setSelectedDatasetId(event.target.value)}>
              <option value="">Select dataset</option>
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </NativeSelect>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{totals.assets} assets</Badge>
            <Badge variant="outline">{totals.labeled} labeled</Badge>
            <Badge variant="outline">{totals.approved} approved</Badge>
            <Badge variant="secondary">{versions.length} versions</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Batches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
            {!loading && batches.length === 0 ? <p className="text-sm text-muted-foreground">No batches yet.</p> : null}
            {batches.map((batch) => (
              <div key={batch.id} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{batch.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {batch.source_type} • {new Date(batch.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant="outline">{batch.status}</Badge>
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{batch.item_count} assets</span>
                  <span>{batch.labeled_count} labeled</span>
                  <span>{batch.approved_count} approved</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyBatchId === batch.id}
                    onClick={() => void updateBatchStatus(batch.id, "in_review")}
                  >
                    In Review
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyBatchId === batch.id}
                    onClick={() => void updateBatchStatus(batch.id, "approved")}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyBatchId === batch.id}
                    onClick={() => void buildVersion(batch.id)}
                  >
                    Build Version
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Versions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {versions.length === 0 ? <p className="text-sm text-muted-foreground">No versions yet.</p> : null}
            {versions.map((version, index) => (
              <div key={version.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Version {version.version_number}</p>
                    <p className="text-xs text-muted-foreground">{new Date(version.created_at).toLocaleString()}</p>
                  </div>
                  <Badge>{version.item_count} records</Badge>
                </div>
                {index < versions.length - 1 ? <Separator className="mt-3" /> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
