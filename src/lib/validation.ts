import {
  DEPLOYMENT_PREFERENCES,
  EXPERIENCE_LEVELS,
  PROJECT_CATEGORIES,
  type ProjectDraft,
  type ProjectRequest,
} from "@/types/project";

export const MAX_IDEA_LENGTH = 1000;
export const MAX_BUDGET_INR = 100_000_000;
export const MAX_REQUIREMENTS_LENGTH = 800;
export const MAX_TECHNOLOGIES = 6;
export const MAX_TECHNOLOGY_LENGTH = 40;

export type ProjectDraftField =
  | "idea"
  | "category"
  | "budgetInr"
  | "experienceLevel"
  | "preferredTechnologies"
  | "deploymentPreference"
  | "additionalRequirements";

export type ProjectDraftErrors = Partial<
  Record<ProjectDraftField, string>
>;

function isOneOf<T extends readonly string[]>(
  value: string,
  options: T,
): value is T[number] {
  return options.includes(value);
}

export function validateProjectDraft(draft: ProjectDraft): ProjectDraftErrors {
  const errors: ProjectDraftErrors = {};
  const idea = draft.idea.trim();

  if (idea.length < 8) {
    errors.idea = "Tell us a little more—use at least 8 non-space characters.";
  } else if (idea.length > MAX_IDEA_LENGTH) {
    errors.idea = `Keep your idea under ${MAX_IDEA_LENGTH.toLocaleString()} characters.`;
  }

  if (!isOneOf(draft.category, PROJECT_CATEGORIES)) {
    errors.category = "Choose a project category.";
  }

  const budget = draft.budgetInr.trim();
  if (budget) {
    const parsedBudget = Number(budget);
    if (!/^\d+$/.test(budget) || !Number.isSafeInteger(parsedBudget)) {
      errors.budgetInr = "Enter a whole number in INR, such as 25000.";
    } else if (parsedBudget < 0 || parsedBudget > MAX_BUDGET_INR) {
      errors.budgetInr = `Use an amount from ₹0 to ₹${MAX_BUDGET_INR.toLocaleString("en-IN")}.`;
    }
  }

  if (!isOneOf(draft.experienceLevel, EXPERIENCE_LEVELS)) {
    errors.experienceLevel = "Choose your experience level.";
  }

  if (draft.preferredTechnologies.length > MAX_TECHNOLOGIES) {
    errors.preferredTechnologies = `Choose up to ${MAX_TECHNOLOGIES} technologies.`;
  } else if (
    draft.preferredTechnologies.some(
      (technology) =>
        technology.trim().length === 0 ||
        technology.trim().length > MAX_TECHNOLOGY_LENGTH,
    )
  ) {
    errors.preferredTechnologies = `Each preference must be between 1 and ${MAX_TECHNOLOGY_LENGTH} characters.`;
  } else if (
    !draft.noTechnologyPreference &&
    draft.preferredTechnologies.length === 0
  ) {
    errors.preferredTechnologies =
      "Choose a technology or select ‘No preference’ to continue.";
  }

  if (!isOneOf(draft.deploymentPreference, DEPLOYMENT_PREFERENCES)) {
    errors.deploymentPreference = "Choose a deployment preference.";
  }

  if (draft.additionalRequirements.trim().length > MAX_REQUIREMENTS_LENGTH) {
    errors.additionalRequirements = `Keep requirements under ${MAX_REQUIREMENTS_LENGTH} characters.`;
  }

  return errors;
}

export function createProjectRequest(
  draft: ProjectDraft,
  submittedAt = new Date().toISOString(),
): ProjectRequest {
  const budget = draft.budgetInr.trim();

  return {
    idea: draft.idea.trim(),
    category: draft.category,
    budgetInr: budget ? Number(budget) : null,
    experienceLevel: draft.experienceLevel,
    preferredTechnologies: draft.noTechnologyPreference
      ? []
      : draft.preferredTechnologies.map((technology) => technology.trim()),
    deploymentPreference: draft.deploymentPreference,
    additionalRequirements: draft.additionalRequirements.trim(),
    submittedAt,
  };
}

export function hasProjectDraftErrors(errors: ProjectDraftErrors) {
  return Object.keys(errors).length > 0;
}
