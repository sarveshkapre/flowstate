"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent } from "@shadcn-ui/card";

type Project = {
  id: string;
  name: string;
  project_type: string;
  visibility: "private" | "public";
};

export function WorkflowsClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProjects() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/v2/projects?organizationId=org_default", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as { projects?: Project[]; error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load projects.");
        }

        if (!cancelled) {
          setProjects(payload.projects ?? []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load projects.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  const firstProjectId = useMemo(() => projects[0]?.id ?? null, [projects]);

  return (
    <section className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(360px,560px)_1fr]">
        <Card className="border-border">
          <CardContent className="space-y-4 p-6">
            <p className="text-base font-semibold text-primary">Workflows</p>
            <h1 className="text-5xl font-semibold leading-[1.03] tracking-tight">Quickly build vision applications</h1>
            <p className="text-xl text-muted-foreground">
              Connect blocks to create production-ready OpenAI vision workflows.
            </p>
            <div className="space-y-2 pt-2">
              <Button className="h-12 w-full text-lg" asChild>
                <Link href={firstProjectId ? `/projects/${firstProjectId}/workflows` : "/projects"}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create a Workflow
                </Link>
              </Button>
              <Button variant="outline" className="h-12 w-full text-lg" asChild>
                <Link href={firstProjectId ? `/projects/${firstProjectId}/workflows` : "/projects"}>
                  Browse Templates
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border">
          <CardContent className="relative h-full min-h-[420px] p-6">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_10%,rgba(59,130,246,0.14),transparent_44%),radial-gradient(circle_at_90%_90%,rgba(16,185,129,0.14),transparent_40%)]" />
            <div className="relative mx-auto mt-5 max-w-sm space-y-3">
              <div className="rounded-lg border border-border bg-background p-3 shadow-sm">Input</div>
              <div className="mx-auto h-6 w-px bg-border" />
              <div className="rounded-lg border border-violet-300 bg-violet-50 p-3 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
                Detect Boxes
              </div>
              <div className="mx-auto h-6 w-px bg-border" />
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                Filter to Zone
              </div>
              <div className="mx-auto h-6 w-px bg-border" />
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
                  Add Boxes
                </div>
                <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300">
                  Count Boxes
                </div>
              </div>
              <div className="mx-auto h-6 w-px bg-border" />
              <div className="rounded-lg border border-border bg-background p-3 shadow-sm">Response</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-base font-semibold">Project Workspaces</p>
            <Badge variant="outline">{projects.length}</Badge>
          </div>
          {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
          {!loading && projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">Create a project first to build workflows.</p>
          ) : null}
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}/workflows`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-muted/50"
            >
              <div>
                <p className="text-sm font-medium">{project.name}</p>
                <p className="text-xs text-muted-foreground">{project.project_type.replaceAll("_", " ")}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </section>
  );
}
