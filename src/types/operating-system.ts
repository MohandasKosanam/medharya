import type { ProjectWorkspace } from "@/types/workspace";
import type { SolutionPlan } from "@/types/solution";
import type { WorkspaceMessage } from "@/types/workspace";

/** The source of a record is intentionally explicit so generated suggestions are reviewable. */
export type OperatingSystemProvenance =
  | "user"
  | "system"
  | "deterministic"
  | "model-assisted"
  | "web-researched"
  | "imported";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export const BRANCH_TEMPLATES = [
  "product-strategy",
  "market-research",
  "development-architecture",
  "ui-ux-design",
  "marketing-growth",
  "finance-budget",
  "operations",
  "legal-compliance",
  "customer-support",
  "automation",
] as const;

export type BranchTemplate = (typeof BRANCH_TEMPLATES)[number];

export const BRANCH_STATUSES = ["active", "archived"] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

export interface BranchTemplateDefinition {
  template: BranchTemplate;
  name: string;
  description: string;
}

/** Persisted coordinates for a branch in the project idea map. */
export interface CanvasPosition {
  x: number;
  y: number;
}

/** Persisted camera state for the project idea map. */
export interface CanvasViewport {
  zoom: number;
  pan: CanvasPosition;
}

export const DEFAULT_BRANCH_TEMPLATES: readonly BranchTemplateDefinition[] = [
  {
    template: "product-strategy",
    name: "Product Strategy",
    description: "Clarify the user, problem, scope, and product decisions that need evidence.",
  },
  {
    template: "market-research",
    name: "Market Research",
    description: "Investigate users, alternatives, competitors, and evidence for the opportunity.",
  },
  {
    template: "development-architecture",
    name: "Development & Architecture",
    description: "Capture architecture, tooling, data, integrations, and technical foundations.",
  },
  {
    template: "ui-ux-design",
    name: "UI/UX Design",
    description: "Shape the user experience, interface states, accessibility, and design decisions.",
  },
  {
    template: "marketing-growth",
    name: "Marketing & Growth",
    description: "Define positioning, acquisition experiments, messaging, and growth signals.",
  },
  {
    template: "finance-budget",
    name: "Finance & Budget",
    description: "Track budget constraints, cost drivers, pricing assumptions, and financial risks.",
  },
  {
    template: "operations",
    name: "Operations",
    description: "Prepare delivery, monitoring, support operations, and handover work.",
  },
  {
    template: "legal-compliance",
    name: "Legal & Compliance",
    description: "Record privacy, security, legal, policy, and compliance questions.",
  },
  {
    template: "customer-support",
    name: "Customer Support",
    description: "Define support channels, feedback handling, and service recovery workflows.",
  },
  {
    template: "automation",
    name: "Automation",
    description: "Design safe, approval-aware workflows without implying a live scheduler.",
  },
] as const;

export interface ProjectBranch {
  id: string;
  workspaceId: ProjectWorkspace["id"];
  name: string;
  template: BranchTemplate;
  description: string;
  status: BranchStatus;
  provenance: OperatingSystemProvenance;
  approvalStatus: ApprovalStatus;
  parentBranchId?: string;
  canvasPosition?: CanvasPosition;
  messages: WorkspaceMessage[];
  requirements: string[];
  researchFindingIds: string[];
  decisionIds: string[];
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type BranchEdgeRelationship = "depends-on" | "informs" | "blocks" | "related-to";

export interface BranchEdge {
  id: string;
  fromBranchId: ProjectBranch["id"];
  toBranchId: ProjectBranch["id"];
  relationship: BranchEdgeRelationship;
  status: "active" | "archived";
  provenance: OperatingSystemProvenance;
  approvalStatus: ApprovalStatus;
  rationale: string;
}

export type TaskStatus = "draft" | "ready" | "in-progress" | "blocked" | "done" | "cancelled";

export interface Task {
  id: string;
  title: string;
  description: string;
  branchId: ProjectBranch["id"];
  milestoneId?: string;
  status: TaskStatus;
  dependencyIds: string[];
  blockedBy: string[];
  acceptanceCriteria: string[];
  provenance: OperatingSystemProvenance;
  approvalStatus: ApprovalStatus;
  sourcePlanVersion?: SolutionPlan["version"];
  createdAt: string;
  updatedAt: string;
}

export type MilestoneStatus = "draft" | "active" | "complete" | "archived";

export interface Milestone {
  id: string;
  name: string;
  description: string;
  branchId: ProjectBranch["id"];
  status: MilestoneStatus;
  taskIds: string[];
  provenance: OperatingSystemProvenance;
  approvalStatus: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
}

export type AutomationTrigger = "manual";
export type AutomationDefinitionStatus = "available" | "disabled";

export interface AutomationStep {
  id: string;
  label: string;
  description: string;
  requiresApproval: boolean;
}

export interface AutomationDefinition {
  id: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  executionMode: "manual-only";
  status: AutomationDefinitionStatus;
  steps: AutomationStep[];
  safetyNotes: string[];
  provenance: OperatingSystemProvenance;
  approvalStatus: ApprovalStatus;
}

export type AutomationRunStatus = "completed" | "blocked" | "failed";

export interface AutomationRun {
  id: string;
  automationId: AutomationDefinition["id"];
  status: AutomationRunStatus;
  trigger: "manual";
  executionMode: "manual-only";
  scheduled: false;
  summary: string;
  output: string[];
  provenance: OperatingSystemProvenance;
  approvalStatus: ApprovalStatus;
}

export type DiscoveryField =
  | "idea"
  | "category"
  | "audience"
  | "firstUserJourney"
  | "successMetric"
  | "budgetInr"
  | "experienceLevel"
  | "preferredTechnologies"
  | "deploymentPreference"
  | "constraints";

export type DiscoveryQuestionStatus = "open" | "answered" | "skipped";

export interface DiscoveryQuestion {
  id: string;
  field: DiscoveryField;
  prompt: string;
  rationale: string;
  required: boolean;
  priority: number;
  status: DiscoveryQuestionStatus;
  provenance: OperatingSystemProvenance;
  approvalStatus: ApprovalStatus;
}

export type DiscoveryAnswerStatus = "provided" | "confirmed" | "rejected";

export interface DiscoveryAnswer {
  id: string;
  questionId: DiscoveryQuestion["id"];
  field: DiscoveryField;
  value: string;
  status: DiscoveryAnswerStatus;
  provenance: OperatingSystemProvenance;
  approvalStatus: ApprovalStatus;
}

export type DecisionStatus = "proposed" | "accepted" | "rejected" | "superseded";

export interface DecisionRecord {
  id: string;
  title: string;
  decision: string;
  rationale: string;
  status: DecisionStatus;
  provenance: OperatingSystemProvenance;
  approvalStatus: ApprovalStatus;
  relatedBranchIds: string[];
  recordedAt: string;
}

export type UserPreferencesStatus = "active" | "archived";

export interface UserPreferences {
  id: string;
  status: UserPreferencesStatus;
  defaultBranchTemplate: BranchTemplate;
  preferredAutomationIds: string[];
  discoveryCadence: "minimal" | "progressive" | "thorough";
  provenance: OperatingSystemProvenance;
  approvalStatus: ApprovalStatus;
}

export interface ProjectOperatingSystem {
  branches: ProjectBranch[];
  edges: BranchEdge[];
  /** Optional so legacy browser/server records remain readable. */
  viewport?: CanvasViewport;
  /** Transitional alias accepted while older milestone records are upgraded. */
  canvasViewport?: CanvasViewport;
  tasks: Task[];
  milestones: Milestone[];
  automations: AutomationDefinition[];
  automationRuns: AutomationRun[];
  discoveryQuestions: DiscoveryQuestion[];
  discoveryAnswers: DiscoveryAnswer[];
  decisions: DecisionRecord[];
  branchImpactSuggestions: BranchImpactSuggestion[];
  preferences: UserPreferences;
}

export interface BranchDraft {
  id?: string;
  workspaceId?: string;
  name: string;
  template?: BranchTemplate;
  description?: string;
  status?: BranchStatus;
  provenance?: OperatingSystemProvenance;
  approvalStatus?: ApprovalStatus;
  parentBranchId?: string;
  canvasPosition?: CanvasPosition;
  timestamp?: string;
}

export interface TaskDraftOptions {
  branchId?: string;
  existingTasks?: Task[];
  provenance?: OperatingSystemProvenance;
  approvalStatus?: ApprovalStatus;
  timestamp?: string;
}

export interface TaskStatusUpdateResult {
  tasks: Task[];
  accepted: boolean;
  reason: string;
  blockedBy: string[];
}

export type BranchImpact = "high" | "medium" | "low";

export interface BranchImpactSuggestion {
  branchId: ProjectBranch["id"];
  branchName: ProjectBranch["name"];
  impact: BranchImpact;
  reason: string;
  suggestedAction: string;
  provenance: OperatingSystemProvenance;
  approvalStatus: ApprovalStatus;
}

export type DiscoveryContext =
  | ProjectWorkspace
  | Partial<Record<DiscoveryField, unknown>>;
