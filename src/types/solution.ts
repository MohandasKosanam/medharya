import type { TechnologyTool } from "@/catalog/types";

export type RecommendationProvenance =
  | "deterministic-catalogue"
  | "model-assisted"
  | "web-researched";

export interface PlanStackItem {
  toolId: string;
  toolName: string;
  category: string;
  reason: string;
  tradeoffs: string[];
  confidence: "high" | "medium" | "low";
}

export interface CompatibilityCheck {
  status: "pass" | "warning" | "unknown";
  summary: string;
  toolIds: string[];
}

export interface PlanAlternative {
  toolId: string;
  toolName: string;
  tradeoff: string;
}

export interface PlanStep {
  order: number;
  title: string;
  detail: string;
  outcome: string;
}

export interface PlanSource {
  kind: "catalogue" | "official-documentation" | "web-research";
  label: string;
  url?: string;
  retrievedAt?: string;
  verificationStatus: "curated" | "retrieved" | "not-available";
}

export interface SolutionPlan {
  version: number;
  generatedAt: string;
  provenance: RecommendationProvenance;
  summary: string;
  stack: PlanStackItem[];
  compatibility: CompatibilityCheck[];
  alternatives: PlanAlternative[];
  budget: {
    currency: "INR";
    budgetInr: number | null;
    costDrivers: string[];
    notes: string[];
  };
  roadmap: PlanStep[];
  assumptions: string[];
  openQuestions: string[];
  sources: PlanSource[];
}

export interface RecommendationCandidate {
  tool: TechnologyTool;
  score: number;
  reasons: string[];
  tradeoffs: string[];
}
