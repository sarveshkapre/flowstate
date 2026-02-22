import { notFound } from "next/navigation";

import { ProjectSidebar } from "@/components/project-sidebar";
import { getProject } from "@/lib/data-store-v2";

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
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6">
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <ProjectSidebar projectId={project.id} projectName={project.name} />
        <section className="space-y-6">{children}</section>
      </div>
    </main>
  );
}
