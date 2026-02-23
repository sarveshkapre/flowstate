import { ClipViewerClient } from "./clip-viewer-client";

type PageParams = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export default async function ClipViewerPage({ params }: PageParams) {
  const { projectId, artifactId } = await params;
  return <ClipViewerClient projectId={projectId} artifactId={artifactId} />;
}
