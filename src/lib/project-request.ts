import {
  DEPLOYMENT_PREFERENCES,
  EXPERIENCE_LEVELS,
  PROJECT_CATEGORIES,
  type ProjectRequest,
} from "@/types/project";
import {
  MAX_BUDGET_INR,
  MAX_IDEA_LENGTH,
  MAX_REQUIREMENTS_LENGTH,
  MAX_TECHNOLOGIES,
  MAX_TECHNOLOGY_LENGTH,
} from "@/lib/validation";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function includes<T extends readonly string[]>(options: T, value: unknown): value is T[number] {
  return typeof value === "string" && options.includes(value);
}

export function isProjectRequest(value: unknown): value is ProjectRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.idea === "string" && value.idea.trim().length >= 8 && value.idea.trim().length <= MAX_IDEA_LENGTH &&
    includes(PROJECT_CATEGORIES, value.category) &&
    (value.budgetInr === null || (typeof value.budgetInr === "number" && Number.isSafeInteger(value.budgetInr) && value.budgetInr >= 0 && value.budgetInr <= MAX_BUDGET_INR)) &&
    includes(EXPERIENCE_LEVELS, value.experienceLevel) &&
    Array.isArray(value.preferredTechnologies) && value.preferredTechnologies.length <= MAX_TECHNOLOGIES && value.preferredTechnologies.every((item) => typeof item === "string" && item.trim().length <= MAX_TECHNOLOGY_LENGTH) &&
    includes(DEPLOYMENT_PREFERENCES, value.deploymentPreference) &&
    typeof value.additionalRequirements === "string" && value.additionalRequirements.trim().length <= MAX_REQUIREMENTS_LENGTH &&
    typeof value.submittedAt === "string"
  );
}
