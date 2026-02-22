import { VideoWorkspaceClient } from "./video-workspace-client";

export default async function ProjectVideoPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <VideoWorkspaceClient projectId={projectId} />;
}
