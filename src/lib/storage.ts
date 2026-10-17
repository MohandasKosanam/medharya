import {
  DEFAULT_PROJECT_DRAFT,
  DEPLOYMENT_PREFERENCES,
  EXPERIENCE_LEVELS,
  PROJECT_CATEGORIES,
  type ProjectDraft,
} from "@/types/project";

export const PROJECT_DRAFT_STORAGE_KEY = "medharya:project-draft:v1";
export const ANONYMOUS_DRAFT_ID_STORAGE_KEY = "medharya:anonymous-draft-id:v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  );
}

function isProjectDraft(value: unknown): value is ProjectDraft {
  if (!isRecord(value)) return false;

  return (
    typeof value.idea === "string" &&
    typeof value.category === "string" &&
    PROJECT_CATEGORIES.includes(value.category as ProjectDraft["category"]) &&
    typeof value.budgetInr === "string" &&
    typeof value.experienceLevel === "string" &&
    EXPERIENCE_LEVELS.includes(
      value.experienceLevel as ProjectDraft["experienceLevel"],
    ) &&
    isStringArray(value.preferredTechnologies) &&
    typeof value.noTechnologyPreference === "boolean" &&
    typeof value.deploymentPreference === "string" &&
    DEPLOYMENT_PREFERENCES.includes(
      value.deploymentPreference as ProjectDraft["deploymentPreference"],
    ) &&
    typeof value.additionalRequirements === "string"
  );
}

export function loadProjectDraft(): ProjectDraft | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(PROJECT_DRAFT_STORAGE_KEY);
    if (!stored) return null;

    const parsed: unknown = JSON.parse(stored);
    return isProjectDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveProjectDraft(draft: ProjectDraft): boolean {
  if (typeof window === "undefined") return false;

  try {
    window.localStorage.setItem(
      PROJECT_DRAFT_STORAGE_KEY,
      JSON.stringify(draft),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearProjectDraft(): boolean {
  if (typeof window === "undefined") return false;

  try {
    window.localStorage.removeItem(PROJECT_DRAFT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadAnonymousDraftId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(ANONYMOUS_DRAFT_ID_STORAGE_KEY)?.trim() ?? "";
    return value.length > 0 && value.length <= 200 ? value : null;
  } catch {
    return null;
  }
}

export function saveAnonymousDraftId(id: string): boolean {
  if (typeof window === "undefined" || id.trim().length === 0 || id.trim().length > 200) return false;

  try {
    window.localStorage.setItem(ANONYMOUS_DRAFT_ID_STORAGE_KEY, id.trim());
    return true;
  } catch {
    return false;
  }
}

export function clearAnonymousDraftId(): boolean {
  if (typeof window === "undefined") return false;

  try {
    window.localStorage.removeItem(ANONYMOUS_DRAFT_ID_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function getDefaultProjectDraft(): ProjectDraft {
  return { ...DEFAULT_PROJECT_DRAFT, preferredTechnologies: [] };
}
