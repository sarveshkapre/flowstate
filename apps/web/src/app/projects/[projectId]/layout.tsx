import { notFound } from "next/navigation";

import { getProject } from "@/lib/data-store-v2";
import { ProjectWorkspaceShell } from "@/components/project-workspace-shell";

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
    <ProjectWorkspaceShell projectId={project.id} projectName={project.name}>
      {children}
    </ProjectWorkspaceShell>
  );
}
