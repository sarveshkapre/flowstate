import { FlowEditorClient } from "./flow-editor-client";

export default async function ProjectFlowEditorPage({
  params,
}: {
  params: Promise<{ projectId: string; flowId: string }>;
}) {
  const { projectId, flowId } = await params;
  return <FlowEditorClient projectId={projectId} flowId={flowId} />;
}
