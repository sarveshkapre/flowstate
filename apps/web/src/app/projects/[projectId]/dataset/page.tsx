import { DatasetWorkspaceClient } from "./dataset-workspace-client";

export default async function ProjectDatasetPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <DatasetWorkspaceClient projectId={projectId} />;
}
