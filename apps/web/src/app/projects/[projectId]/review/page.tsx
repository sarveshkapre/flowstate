import { ReviewWorkspaceClient } from "./review-workspace-client";

export default async function ProjectReviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ReviewWorkspaceClient projectId={projectId} />;
}
