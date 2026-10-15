import type {
  ExperienceLevel,
  ProjectCategory,
} from "@/types/project";

export type CatalogueCategory =
  | "language"
  | "frontend"
  | "backend"
  | "database"
  | "authentication"
  | "ai-provider"
  | "hosting"
  | "version-control"
  | "testing"
  | "analytics"
  | "developer-tool";

export type PricingModel =
  | "open-source"
  | "freemium"
  | "usage-based"
  | "paid"
  | "unknown";

export interface CatalogueTool {
  id: string;
  name: string;
  category: CatalogueCategory;
  description: string;
  intendedUse: string;
  suitableProjectTypes: ProjectCategory[];
  skillLevels: ExperienceLevel[];
  pricingModel: PricingModel;
  freeTier: {
    status: "available-to-verify" | "not-applicable" | "unknown";
    note: string;
  };
  compatibility: {
    worksWellWith: string[];
    conflictsWith: string[];
    notes: string[];
  };
  officialUrl: string;
  documentationUrl: string;
  pricingUrl?: string;
  source: {
    label: "Official product pages";
    verificationStatus: "curated-not-live-verified";
    lastVerified: string | null;
  };
  tags: string[];
}

export type TechnologyTool = CatalogueTool;
