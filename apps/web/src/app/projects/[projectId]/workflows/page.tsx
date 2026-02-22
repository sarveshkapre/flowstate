import { ProjectWorkflowsClient } from "./project-workflows-client";

export default async function ProjectWorkflowsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectWorkflowsClient projectId={projectId} />;
}
