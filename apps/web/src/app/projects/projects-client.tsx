"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Circle, Lock, Plus, Trash2 } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";
import { Input } from "@shadcn-ui/input";

type Project = {
  id: string;
  name: string;
  slug: string;
  visibility: "private" | "public";
  created_at: string;
};

const STALE_DEMO_PROJECT_PREFIXES = ["PMF ", "Video Ingest Project", "Ingest Project", "PMF Verify", "PMF Batch Project"];

function isVisibleProject(name: string) {
  return !STALE_DEMO_PROJECT_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function ProjectsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);

  const [name, setName] = useState("My Project");
  const [visibility, setVisibility] = useState<"private" | "public">("private");

  async function loadProjects() {
    setLoading(true);
    const response = await fetch("/api/v2/projects?organizationId=org_default", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { projects?: Project[] };
    setProjects(payload.projects ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setShowCreate(true);
    }
  }, [searchParams]);

  const filteredProjects = useMemo(() => {
    const text = query.trim().toLowerCase();
    const visible = projects.filter((project) => isVisibleProject(project.name));

    if (!text) {
      return visible;
    }

    return visible.filter((project) => {
      const name = project.name.toLowerCase();
      return name.includes(text) || project.slug.includes(text);
    });
  }, [projects, query]);

  async function onCreateProject() {
    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const createResponse = await fetch("/api/v2/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: "org_default",
          name: name.trim(),
          visibility,
        }),
      });
      const createPayload = (await createResponse.json().catch(() => ({}))) as {
        project?: Project;
        error?: string;
      };

      if (!createResponse.ok || !createPayload.project) {
        throw new Error(createPayload.error || "Failed to create project.");
      }

      await fetch("/api/v2/datasets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: createPayload.project.id,
          name: `${createPayload.project.name} Dataset`,
          description: "Primary dataset",
        }),
      });

      await loadProjects();
      setShowCreate(false);
      setName("My Project");
      setVisibility("private");
      router.push(`/projects/${createPayload.project.id}/upload`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create project.");
    } finally {
      setCreating(false);
    }
  }

  async function onDeleteProject(project: Project) {
    setDeletingProjectId(project.id);
    try {
      const response = await fetch(`/api/v2/projects/${project.id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Failed to delete project.");
      }

      await loadProjects();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete project.");
    } finally {
      setDeletingProjectId(null);
    }
  }

  return (
    <section className="space-y-6">
      <Card className="w-full border-border bg-card">
        <CardContent className="space-y-4 p-6">
          <p className="text-base font-semibold text-primary">Projects</p>
          <h1 className="text-4xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-5xl">
            OpenAI Vision Labeling
          </h1>
          <p className="text-xl text-muted-foreground">Upload images or videos and label them with GPT-5.2.</p>
          <Button className="h-12 w-full text-lg" onClick={() => setShowCreate((value) => !value)}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </CardContent>
      </Card>

      {showCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Create Project</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="space-y-1">
              <span className="text-sm font-medium">Project Name</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div>
              <p className="mb-2 text-sm font-medium">Visibility</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={visibility === "private" ? "default" : "outline"}
                  onClick={() => setVisibility("private")}
                >
                  <Lock className="mr-2 h-4 w-4" />
                  Private
                </Button>
                <Button
                  type="button"
                  variant={visibility === "public" ? "default" : "outline"}
                  onClick={() => setVisibility("public")}
                >
                  <Circle className="mr-2 h-4 w-4" />
                  Public
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => setShowCreate(false)} disabled={creating}>
                Cancel
              </Button>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button onClick={() => void onCreateProject()} disabled={creating}>
                {creating ? "Creating..." : "Create"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xl">Your Projects</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Search projects"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-lg"
          />

          {loading ? <p className="text-sm text-muted-foreground">Loading projects...</p> : null}

          {!loading && filteredProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects yet. Create your first project to start.</p>
          ) : null}

          <div className="space-y-3">
            {filteredProjects.map((project) => (
              <Card key={project.id} className="border-border">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="text-base font-semibold text-foreground">{project.name}</p>
                    <Badge variant="outline">
                      <Lock className="mr-1 h-3 w-3" />
                      {project.visibility}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" asChild>
                      <a href={`/projects/${project.id}/upload`}>Open</a>
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void onDeleteProject(project)}
                      disabled={deletingProjectId === project.id}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {deletingProjectId === project.id ? "Deleting..." : "Delete"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
