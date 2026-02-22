"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";

type ExportSnapshot = {
  id: string;
  project_id: string;
  format: "coco";
  image_count: number;
  annotation_count: number;
  class_count: number;
  skipped_asset_count: number;
  file_name: string;
  created_at: string;
};

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export function ExportsWorkspaceClient({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<ExportSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v2/projects/${projectId}/exports`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        exports?: ExportSnapshot[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load exports.");
      }
      setItems(payload.exports ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load exports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function createExport() {
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/v2/projects/${projectId}/exports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        export?: ExportSnapshot;
        error?: string;
      };
      if (!response.ok || !payload.export) {
        throw new Error(payload.error || "Unable to create export.");
      }
      await load();
      setMessage(`Created ${payload.export.id}.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create export.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">Exports</h2>
          <p className="text-sm text-muted-foreground">Immutable local snapshots for COCO export.</p>
        </div>
        <Button type="button" onClick={() => void createExport()} disabled={creating}>
          {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {creating ? "Creating..." : "Create COCO Export"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Version History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading exports...</p> : null}
          {!loading && items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exports yet.</p>
          ) : null}

          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-border/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{item.id}</p>
                  <p className="text-xs text-muted-foreground">{formatTimestamp(item.created_at)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{item.format.toUpperCase()}</Badge>
                  <Badge variant="outline">{item.image_count} images</Badge>
                  <Badge variant="outline">{item.annotation_count} boxes</Badge>
                  <Badge variant="outline">{item.class_count} classes</Badge>
                  {item.skipped_asset_count > 0 ? (
                    <Badge variant="destructive">Skipped {item.skipped_asset_count}</Badge>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/v2/projects/${projectId}/exports/${item.id}`}>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
