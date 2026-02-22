import { SettingsWorkspaceClient } from "./settings-workspace-client";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <SettingsWorkspaceClient projectId={projectId} />;
}
