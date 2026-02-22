import { AnnotateWorkspaceClient } from "./annotate-workspace-client";

export default async function ProjectAnnotatePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <AnnotateWorkspaceClient projectId={projectId} />;
}
