"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FolderOpen, Plus, Trash2 } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";
import { Input } from "@shadcn-ui/input";

type Organization = {
  id: string;
  name: string;
  is_active: boolean;
};

type Project = {
  id: string;
  name: string;
  project_type: string;
  annotation_group: string;
  visibility: "private" | "public";
  created_at: string;
};

type OrganizationListResponse = {
  organizations?: Organization[];
  error?: string;
};

type ProjectListResponse = {
  projects?: Project[];
  error?: string;
};

type CreateProjectResponse = {
  project?: Project;
  error?: string;
};

function formatProjectType(value: string) {
  return value.replace(/[_-]+/g, " ");
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export function ProjectsClient() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectName, setProjectName] = useState("My First Project");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const hasProjects = useMemo(() => projects.length > 0, [projects.length]);

  async function loadProjects(nextOrganizationId: string) {
    const response = await fetch(
      `/api/v2/projects?organizationId=${encodeURIComponent(nextOrganizationId)}&isActive=true`,
      { cache: "no-store" },
    );
    const payload = (await response.json().catch(() => ({}))) as ProjectListResponse;
    if (!response.ok) {
      throw new Error(payload.error || "Failed to load projects.");
    }
    setProjects(payload.projects ?? []);
  }

  async function bootstrap() {
    setLoading(true);
    setError(null);

    try {
      const organizationResponse = await fetch("/api/v1/organizations", { cache: "no-store" });
      const organizationPayload = (await organizationResponse.json().catch(() => ({}))) as OrganizationListResponse;

      if (!organizationResponse.ok) {
        throw new Error(organizationPayload.error || "Failed to load organizations.");
      }

      const firstActive =
        (organizationPayload.organizations ?? []).find((organization) => organization.is_active) ??
        organizationPayload.organizations?.[0];

      if (!firstActive) {
        throw new Error("No active organization found.");
      }

      setOrganizationId(firstActive.id);
      await loadProjects(firstActive.id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load local projects.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreateProject() {
    if (!organizationId) {
      setError("Organization is not ready yet.");
      return;
    }

    const name = projectName.trim();
    if (!name) {
      setError("Project name is required.");
      return;
    }

    setCreating(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/v2/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          name,
          annotationGroup: "objects",
          visibility: "private",
          projectType: "object_detection",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as CreateProjectResponse;
      if (!response.ok || !payload.project) {
        throw new Error(payload.error || "Unable to create project.");
      }

      setProjectName("My First Project");
      await loadProjects(organizationId);
      setMessage(`Created project "${payload.project.name}".`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create project.");
    } finally {
      setCreating(false);
    }
  }

  async function onDeleteProject(project: Project) {
    if (!window.confirm(`Delete project "${project.name}"? This cannot be undone.`)) {
      return;
    }

    setDeletingId(project.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/v2/projects/${project.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Unable to delete project.");
      }

      if (organizationId) {
        await loadProjects(organizationId);
      }
      setMessage(`Deleted project "${project.name}".`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete project.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="mx-auto w-full max-w-[1400px] space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Create a local project, import images/videos, auto-annotate, review, and export.
        </p>
      </div>

      <Card className="border border-border/70">
        <CardHeader>
          <CardTitle className="text-base">Create Project</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Project name"
            className="max-w-sm"
            disabled={creating || loading}
          />
          <Button type="button" onClick={() => void onCreateProject()} disabled={creating || loading || !organizationId}>
            <Plus className="mr-2 h-4 w-4" />
            {creating ? "Creating..." : "New Project"}
          </Button>
        </CardContent>
      </Card>

      {loading ? <p className="text-sm text-muted-foreground">Loading projects...</p> : null}

      {!loading && !hasProjects ? (
        <Card className="border border-dashed border-border">
          <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center">
            <FolderOpen className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No projects yet. Create your first project to start labeling.</p>
          </CardContent>
        </Card>
      ) : null}

      {hasProjects ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} className="border border-border/70">
              <CardHeader className="space-y-2">
                <CardTitle className="text-base">{project.name}</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{formatProjectType(project.project_type)}</Badge>
                  <Badge variant="outline">{project.annotation_group}</Badge>
                  <Badge variant={project.visibility === "public" ? "secondary" : "outline"}>
                    {project.visibility}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Created {formatDateTime(project.created_at)}</p>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href={`/projects/${project.id}/upload`}>
                    Open
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={deletingId === project.id}
                  onClick={() => void onDeleteProject(project)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {deletingId === project.id ? "Deleting..." : "Delete"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {message ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
