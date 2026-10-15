import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

export const instant = false;

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <WorkspaceShell projectId={projectId} />;
}
