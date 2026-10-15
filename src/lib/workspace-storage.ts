import type { ProjectWorkspace } from "@/types/workspace";
import { ensureOperatingSystem } from "@/lib/operating-system";

export const PROJECT_WORKSPACES_STORAGE_KEY = "medharya:workspaces:v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProjectWorkspace(value: unknown): value is ProjectWorkspace {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isRecord(value.request) &&
    typeof value.request.idea === "string" &&
    Array.isArray(value.messages) &&
    isRecord(value.memory) &&
    Array.isArray(value.researchFindings) &&
    isRecord(value.plan) &&
    Array.isArray(value.plan.stack) &&
    Array.isArray(value.plan.roadmap) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function readWorkspaceMap(): Record<string, ProjectWorkspace> {
  if (typeof window === "undefined") return {};

  try {
    const stored = window.localStorage.getItem(PROJECT_WORKSPACES_STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, workspace]) => isProjectWorkspace(workspace))
        .map(([id, workspace]) => [id, ensureOperatingSystem(workspace as ProjectWorkspace)]),
    ) as Record<string, ProjectWorkspace>;
  } catch {
    return {};
  }
}

function writeWorkspaceMap(workspaces: Record<string, ProjectWorkspace>) {
  if (typeof window === "undefined") return false;

  try {
    window.localStorage.setItem(
      PROJECT_WORKSPACES_STORAGE_KEY,
      JSON.stringify(workspaces),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadProjectWorkspace(projectId: string) {
  return readWorkspaceMap()[projectId] ?? null;
}

export function listProjectWorkspaces() {
  return Object.values(readWorkspaceMap()).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function saveProjectWorkspace(workspace: ProjectWorkspace) {
  const workspaces = readWorkspaceMap();
  workspaces[workspace.id] = workspace;
  return writeWorkspaceMap(workspaces);
}

export function deleteProjectWorkspace(projectId: string) {
  const workspaces = readWorkspaceMap();
  delete workspaces[projectId];
  return writeWorkspaceMap(workspaces);
}
