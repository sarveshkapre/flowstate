import { UploadWorkspaceClient } from "./upload-workspace-client";

export default async function ProjectUploadPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <UploadWorkspaceClient projectId={projectId} />;
}
