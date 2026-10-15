import type { ProjectRequest } from "@/types/project";
import type { ResearchFinding } from "@/types/research";
import type { SolutionPlan } from "@/types/solution";

export type WorkspaceMessageRole = "user" | "assistant";

export type WorkspaceMessageSource =
  | "user"
  | "deterministic-fallback"
  | "model-assisted"
  | "web-researched";

export interface WorkspaceMessageCitation {
  title: string;
  url: string;
  retrievedAt: string;
}

export interface WorkspaceMessage {
  id: string;
  role: WorkspaceMessageRole;
  content: string;
  createdAt: string;
  source: WorkspaceMessageSource;
  citations?: WorkspaceMessageCitation[];
}

export interface ProjectMemory {
  confirmedRequirements: string[];
  userPreferences: string[];
  technologyDecisions: string[];
  rejectedAlternatives: string[];
  openQuestions: string[];
  recentSummary: string;
  currentPlanVersion: number;
}

export interface ProjectWorkspace {
  id: string;
  name: string;
  request: ProjectRequest;
  messages: WorkspaceMessage[];
  memory: ProjectMemory;
  researchFindings: ResearchFinding[];
  plan: SolutionPlan;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRequestPatch {
  idea?: string;
  category?: ProjectRequest["category"];
  budgetInr?: number | null;
  experienceLevel?: ProjectRequest["experienceLevel"];
  preferredTechnologies?: string[];
  deploymentPreference?: ProjectRequest["deploymentPreference"];
  additionalRequirements?: string;
}
