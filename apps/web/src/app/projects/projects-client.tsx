"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Circle, Lock, Plus, Tag, X } from "lucide-react";

import { Badge } from "@shadcn-ui/badge";
import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";
import { Input } from "@shadcn-ui/input";
import { cn } from "@shadcn-lib/utils";

type Project = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  annotation_group: string;
  visibility: "private" | "public";
  project_type:
    | "object_detection"
    | "classification"
    | "instance_segmentation"
    | "keypoint_detection"
    | "multimodal"
    | "semantic_segmentation";
  created_at: string;
};

type ProjectTypeItem = {
  key: Project["project_type"];
  label: string;
  summary: string;
  pills: string[];
};

const PROJECT_TYPES: ProjectTypeItem[] = [
  {
    key: "object_detection",
    label: "Object Detection",
    summary: "Identify objects and their positions with bounding boxes.",
    pills: ["Bounding Boxes", "Counts", "Tracking"],
  },
  {
    key: "classification",
    label: "Classification",
    summary: "Assign labels at image-level or multi-label groups.",
    pills: ["Image Labels", "Filtering", "Moderation"],
  },
  {
    key: "instance_segmentation",
    label: "Instance Segmentation",
    summary: "Annotate fine-grained object outlines and polygons.",
    pills: ["Polygons", "Masks", "Measuring"],
  },
  {
    key: "keypoint_detection",
    label: "Keypoint Detection",
    summary: "Identify skeleton/keypoint positions for each instance.",
    pills: ["Pose", "Joints", "Tracking"],
  },
  {
    key: "multimodal",
    label: "Multimodal",
    summary: "Pair image regions with language prompts and captions.",
    pills: ["Prompts", "VQA", "Captions"],
  },
  {
    key: "semantic_segmentation",
    label: "Semantic Segmentation",
    summary: "Assign dense labels to all pixels in the image.",
    pills: ["Pixel Masks", "Scene Parsing", "Robotics"],
  },
];

export function ProjectsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("My First Project");
  const [annotationGroup, setAnnotationGroup] = useState("objects");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [projectType, setProjectType] = useState<Project["project_type"]>("object_detection");

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

  useEffect(() => {
    if (!showCreate) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showCreate]);

  const filteredProjects = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) {
      return projects;
    }
    return projects.filter((project) => {
      return (
        project.name.toLowerCase().includes(text) ||
        project.slug.toLowerCase().includes(text) ||
        project.project_type.toLowerCase().includes(text)
      );
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
          annotationGroup: annotationGroup.trim() || "objects",
          visibility,
          projectType,
        }),
      });
      const createPayload = (await createResponse.json().catch(() => ({}))) as { project?: Project; error?: string };

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
      router.push(`/projects/${createPayload.project.id}/upload`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create project.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="space-y-6">
      <Card className="max-w-[560px] overflow-hidden border-border bg-card">
        <CardContent className="space-y-4 p-6">
          <p className="text-base font-semibold text-primary">Projects</p>
          <h1 className="text-5xl font-semibold leading-[1.02] tracking-tight text-foreground">
            Build vision models to recognize anything
          </h1>
          <p className="text-xl text-muted-foreground">Upload data, label it, and automate with OpenAI models.</p>
          <div className="space-y-2 pt-2">
            <Button className="h-12 w-full text-lg" onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Button>
            <Button variant="outline" className="h-12 w-full text-lg" asChild>
              <a href="https://platform.openai.com/docs/guides/images-vision" target="_blank" rel="noreferrer">
                View a Tutorial
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

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
            <p className="text-sm text-muted-foreground">No projects yet. Create your first project to start uploading data.</p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredProjects.map((project) => (
              <Card key={project.id} className="border-border">
                <CardContent className="space-y-3 p-4">
                  <div className="space-y-1">
                    <p className="truncate text-lg font-semibold text-foreground">{project.name}</p>
                    <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{project.project_type}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      <Tag className="mr-1 h-3 w-3" />
                      {project.annotation_group}
                    </Badge>
                    <Badge variant="outline">
                      <Lock className="mr-1 h-3 w-3" />
                      {project.visibility}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" asChild>
                      <a href={`/projects/${project.id}/upload`}>Open</a>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <a href={`/projects/${project.id}/workflows`}>Workflows</a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {showCreate ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 backdrop-blur-sm">
          <div className="mx-auto my-6 flex max-h-[calc(100vh-3rem)] max-w-6xl flex-col rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-4xl font-semibold tracking-tight text-foreground">Let&apos;s create your project.</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowCreate(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-6 overflow-y-auto p-6 lg:grid-cols-[1.1fr_1fr]">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-sm font-medium">Project Name</span>
                    <Input value={name} onChange={(event) => setName(event.target.value)} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm font-medium">Annotation Group</span>
                    <Input value={annotationGroup} onChange={(event) => setAnnotationGroup(event.target.value)} />
                  </label>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Visibility</p>
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

                <div className="space-y-2">
                  <p className="text-sm font-medium">Project Type</p>
                  <div className="space-y-2">
                    {PROJECT_TYPES.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setProjectType(item.key)}
                        className={cn(
                          "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                          projectType === item.key ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-lg font-semibold">{item.label}</p>
                          {projectType === item.key ? <Check className="h-4 w-4 text-primary" /> : null}
                        </div>
                        <p className="text-sm text-muted-foreground">{item.summary}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.pills.map((pill) => (
                            <Badge key={pill} variant="outline">
                              {pill}
                            </Badge>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <Card className="overflow-hidden border-border">
                <div className="h-full min-h-64 bg-gradient-to-br from-indigo-500/15 via-fuchsia-500/10 to-cyan-400/10 p-4">
                  <p className="text-sm font-semibold text-muted-foreground">Preview</p>
                  <p className="mt-2 text-2xl font-semibold">{name || "My First Project"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{annotationGroup || "objects"}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge>{visibility}</Badge>
                    <Badge variant="outline">{projectType.replaceAll("_", " ")}</Badge>
                  </div>
                </div>
              </Card>
            </div>

            <div className="flex items-center justify-between border-t border-border px-6 py-4">
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <div className="flex items-center gap-3">
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <Button onClick={() => void onCreateProject()} disabled={creating}>
                  {creating ? "Creating..." : `Continue with ${visibility === "private" ? "Private" : "Public"}`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
