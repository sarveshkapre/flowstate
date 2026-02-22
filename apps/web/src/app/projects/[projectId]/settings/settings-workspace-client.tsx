"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";

type ProjectRecord = {
  id: string;
  name: string;
  annotation_group: string;
  project_type: string;
  visibility: "private" | "public";
  created_at: string;
};

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export function SettingsWorkspaceClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/v2/projects/${projectId}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as { project?: ProjectRecord; error?: string };
        if (!response.ok || !payload.project) {
          throw new Error(payload.error || "Failed to load project settings.");
        }
        if (!cancelled) {
          setProject(payload.project);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load project settings.");
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
  }, [projectId]);

  async function deleteProject() {
    if (!project) {
      return;
    }

    const confirmed = window.confirm(`Delete "${project.name}" and all local data?`);
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/v2/projects/${project.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok && response.status !== 204) {
        throw new Error(payload.error || "Unable to delete project.");
      }

      router.push("/projects");
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete project.");
      setDeleting(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">Local project metadata and destructive controls.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {loading ? <p className="text-muted-foreground">Loading settings...</p> : null}
          {!loading && project ? (
            <>
              <p>
                <span className="text-muted-foreground">Name:</span> {project.name}
              </p>
              <p>
                <span className="text-muted-foreground">Created:</span> {formatDate(project.created_at)}
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{project.project_type}</Badge>
                <Badge variant="outline">{project.annotation_group}</Badge>
                <Badge variant={project.visibility === "public" ? "secondary" : "outline"}>
                  {project.visibility}
                </Badge>
              </div>
            </>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" disabled={deleting || !project} onClick={() => void deleteProject()}>
            {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            {deleting ? "Deleting..." : "Delete Project"}
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
