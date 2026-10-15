export const PROJECT_CATEGORIES = [
  "Web application",
  "AI application",
  "Portfolio website",
  "Hackathon project",
  "Online business",
  "Other",
] as const;

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export const EXPERIENCE_LEVELS = [
  "Beginner",
  "Intermediate",
  "Advanced",
] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const DEPLOYMENT_PREFERENCES = [
  "Local development only",
  "Deploy online",
  "Not decided yet",
] as const;

export type DeploymentPreference = (typeof DEPLOYMENT_PREFERENCES)[number];

export const TECHNOLOGY_OPTIONS = [
  "No preference",
  "TypeScript",
  "React",
  "Next.js",
  "Python",
  "PostgreSQL",
  "Supabase",
  "Firebase",
  "Vercel",
] as const;

export type TechnologyOption = (typeof TECHNOLOGY_OPTIONS)[number];

/** The browser-facing shape used while a person is completing the form. */
export interface ProjectDraft {
  idea: string;
  category: ProjectCategory;
  budgetInr: string;
  experienceLevel: ExperienceLevel;
  preferredTechnologies: string[];
  noTechnologyPreference: boolean;
  deploymentPreference: DeploymentPreference;
  additionalRequirements: string;
}

/** The normalized request boundary for the future recommendation engine. */
export interface ProjectRequest {
  idea: string;
  category: ProjectCategory;
  budgetInr: number | null;
  experienceLevel: ExperienceLevel;
  preferredTechnologies: string[];
  deploymentPreference: DeploymentPreference;
  additionalRequirements: string;
  submittedAt: string;
}

export const DEFAULT_PROJECT_DRAFT: ProjectDraft = {
  idea: "",
  category: "Web application",
  budgetInr: "",
  experienceLevel: "Beginner",
  preferredTechnologies: [],
  noTechnologyPreference: true,
  deploymentPreference: "Not decided yet",
  additionalRequirements: "",
};
