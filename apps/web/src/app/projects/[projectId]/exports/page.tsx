import { ExportsWorkspaceClient } from "./exports-workspace-client";

export default async function ProjectExportsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ExportsWorkspaceClient projectId={projectId} />;
}
