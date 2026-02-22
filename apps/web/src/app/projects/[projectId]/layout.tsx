import { notFound } from "next/navigation";
import Link from "next/link";

import { ProjectSidebar } from "@/components/project-sidebar";
import { getProject } from "@/lib/data-store-v2";
import { Button } from "@shadcn-ui/button";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);

  if (!project) {
    notFound();
  }

  return (
    <section className="mx-auto w-full max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/80 bg-card px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">Local Project</p>
          <h1 className="text-lg font-semibold tracking-tight">{project.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/projects/${project.id}/upload`}>Import</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/projects/${project.id}/annotate`}>Auto-annotate</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/projects/${project.id}/exports`}>Export</Link>
          </Button>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[256px_minmax(0,1fr)]">
        <ProjectSidebar projectId={project.id} projectName={project.name} />
        <section className="space-y-6">{children}</section>
      </div>
    </section>
  );
}
