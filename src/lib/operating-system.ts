import type { ProjectWorkspace } from "@/types/workspace";
import type { SolutionPlan } from "@/types/solution";
import type { WorkspaceMessage } from "@/types/workspace";
import {
  DEFAULT_BRANCH_TEMPLATES,
  type ApprovalStatus,
  type AutomationDefinition,
  type AutomationRun,
  type BranchDraft,
  type BranchEdge,
  type BranchEdgeRelationship,
  type BranchImpactSuggestion,
  type BranchTemplate,
  type DiscoveryAnswer,
  type DiscoveryContext,
  type DiscoveryField,
  type DiscoveryQuestion,
  type ProjectBranch,
  type Task,
  type TaskDraftOptions,
  type TaskStatus,
  type TaskStatusUpdateResult,
  type OperatingSystemProvenance,
  type ProjectOperatingSystem,
  type UserPreferences,
} from "@/types/operating-system";

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function stableId(prefix: string, value: string) {
  return `${prefix}-${slug(value)}`;
}

function uniqueId(base: string, used: Set<string>) {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function nonEmpty(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

function templateDefinition(template: BranchTemplate) {
  return DEFAULT_BRANCH_TEMPLATES.find((item) => item.template === template) ?? DEFAULT_BRANCH_TEMPLATES[0];
}

function branchWelcome(branchName: string, description: string): WorkspaceMessage {
  return {
    id: stableId("branch-message", branchName),
    role: "assistant",
    content: `This is the ${branchName} branch. ${description}\n\nAsk a question here and the branch context will stay separate from the main project conversation.`,
    createdAt: DEFAULT_TIMESTAMP,
    source: "deterministic-fallback",
  };
}

export function createDefaultBranches(workspace: ProjectWorkspace): ProjectBranch[] {
  const timestamp = workspace.updatedAt || workspace.createdAt || DEFAULT_TIMESTAMP;
  return DEFAULT_BRANCH_TEMPLATES.map((definition) => ({
    id: `${workspace.id}-branch-${definition.template}`,
    workspaceId: workspace.id,
    name: definition.name,
    template: definition.template,
    description: definition.description,
    status: "active",
    provenance: "deterministic",
    approvalStatus: "pending",
    messages: [branchWelcome(definition.name, definition.description)],
    requirements: [],
    researchFindingIds: [],
    decisionIds: [],
    taskIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

export function createBranch(branches: ProjectBranch[], draft: BranchDraft): ProjectBranch {
  const template = draft.template ?? "development-architecture";
  const definition = templateDefinition(template);
  const workspaceId = draft.workspaceId ?? branches[0]?.workspaceId ?? "workspace";
  const baseId = draft.id ?? stableId(`${workspaceId}-branch`, draft.name);
  const id = uniqueId(baseId, new Set(branches.map((branch) => branch.id)));
  const timestamp = draft.timestamp ?? DEFAULT_TIMESTAMP;

  return {
    id,
    workspaceId,
    name: nonEmpty(draft.name, definition.name),
    template,
    description: nonEmpty(draft.description, definition.description),
    status: draft.status ?? "active",
    provenance: draft.provenance ?? "user",
    approvalStatus: draft.approvalStatus ?? "pending",
    messages: [],
    requirements: [],
    researchFindingIds: [],
    decisionIds: [],
    taskIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function addBranch(branches: ProjectBranch[], draft: BranchDraft): ProjectBranch[] {
  return [...branches, createBranch(branches, draft)];
}

export function initializeOperatingSystem(workspace: ProjectWorkspace): ProjectOperatingSystem {
  const branches = createDefaultBranches(workspace);
  const buildBranch = branches.find((branch) => branch.template === "development-architecture") ?? branches[0];
  const tasks = createTaskDrafts(workspace.plan, {
    branchId: buildBranch?.id,
    approvalStatus: "pending",
    timestamp: workspace.createdAt || DEFAULT_TIMESTAMP,
  });
  const tasksWithBranch = tasks.map((task) => ({
    ...task,
    branchId: buildBranch?.id ?? task.branchId,
  }));
  const finalBranches = branches.map((branch) =>
    branch.id === buildBranch?.id
      ? { ...branch, taskIds: tasksWithBranch.map((task) => task.id) }
      : branch,
  );
  const preferences: UserPreferences = {
    id: `preferences-${workspace.id}`,
    status: "active",
    defaultBranchTemplate: "product-strategy",
    preferredAutomationIds: [],
    discoveryCadence: "progressive",
    provenance: "system",
    approvalStatus: "approved",
  };

  return {
    branches: finalBranches,
    edges: [],
    tasks: tasksWithBranch,
    milestones: [],
    automations: getSafeAutomationTemplates(),
    automationRuns: [],
    discoveryQuestions: createProgressiveDiscoveryQuestions(workspace),
    discoveryAnswers: [],
    decisions: [],
    branchImpactSuggestions: [],
    preferences,
  };
}

export function ensureOperatingSystem(workspace: ProjectWorkspace): ProjectWorkspace {
  const existing = workspace.operatingSystem;
  if (existing && Array.isArray(existing.branchImpactSuggestions) && existing.branches.every((branch) => Array.isArray(branch.messages))) {
    return workspace;
  }

  const baseline = initializeOperatingSystem(workspace);
  return {
    ...workspace,
    operatingSystem: {
      ...baseline,
      ...existing,
      branchImpactSuggestions: existing?.branchImpactSuggestions ?? [],
      branches: existing?.branches?.map((branch) => ({
        ...baseline.branches.find((candidate) => candidate.id === branch.id),
        ...branch,
        messages: branch.messages ?? [],
        requirements: branch.requirements ?? [],
        researchFindingIds: branch.researchFindingIds ?? [],
        decisionIds: branch.decisionIds ?? [],
        taskIds: branch.taskIds ?? [],
      })) ?? baseline.branches,
    },
  };
}

export function appendBranchMessage(
  workspace: ProjectWorkspace,
  branchId: string,
  nextMessage: WorkspaceMessage,
): ProjectWorkspace {
  const operatingSystem = workspace.operatingSystem ?? initializeOperatingSystem(workspace);
  return {
    ...workspace,
    operatingSystem: {
      ...operatingSystem,
      branches: operatingSystem.branches.map((branch) =>
        branch.id === branchId
          ? { ...branch, messages: [...branch.messages, nextMessage].slice(-60), updatedAt: nextMessage.createdAt }
          : branch,
      ),
    },
    updatedAt: nextMessage.createdAt,
  };
}

export function renameBranch(branches: ProjectBranch[], branchId: string, name: string): ProjectBranch[] {
  const nextName = name.trim();
  if (!nextName) return branches;
  return branches.map((branch) => (branch.id === branchId ? { ...branch, name: nextName } : branch));
}

export function archiveBranch(branches: ProjectBranch[], branchId: string): ProjectBranch[] {
  return branches.map((branch) => (branch.id === branchId ? { ...branch, status: "archived" } : branch));
}

export function reopenBranch(branches: ProjectBranch[], branchId: string): ProjectBranch[] {
  return branches.map((branch) => (branch.id === branchId ? { ...branch, status: "active" } : branch));
}

export function connectBranches(
  edges: BranchEdge[],
  fromBranchId: string,
  toBranchId: string,
  relationship: BranchEdgeRelationship = "related-to",
  rationale = "",
  provenance: OperatingSystemProvenance = "user",
  approvalStatus: ApprovalStatus = "pending",
): BranchEdge[] {
  if (!fromBranchId || !toBranchId || fromBranchId === toBranchId) return edges;
  const duplicate = edges.some(
    (edge) =>
      edge.status === "active" &&
      edge.fromBranchId === fromBranchId &&
      edge.toBranchId === toBranchId &&
      edge.relationship === relationship,
  );
  if (duplicate) return edges;

  const baseId = stableId("edge", `${fromBranchId}-${relationship}-${toBranchId}`);
  const id = uniqueId(baseId, new Set(edges.map((edge) => edge.id)));
  return [
    ...edges,
    {
      id,
      fromBranchId,
      toBranchId,
      relationship,
      status: "active",
      provenance,
      approvalStatus,
      rationale: rationale.trim(),
    },
  ];
}

function taskTitleKey(title: string) {
  return title.trim().toLocaleLowerCase();
}

export function createTaskDrafts(plan: SolutionPlan, options: TaskDraftOptions = {}): Task[] {
  const existingTasks = options.existingTasks ?? [];
  const usedIds = new Set(existingTasks.map((task) => task.id));
  const usedTitles = new Set(existingTasks.map((task) => taskTitleKey(task.title)));
  const timestamp = options.timestamp ?? plan.generatedAt ?? DEFAULT_TIMESTAMP;
  const branchId = options.branchId ?? "build";
  const provenance = options.provenance ?? "deterministic";
  const approvalStatus = options.approvalStatus ?? "pending";

  return plan.roadmap.reduce<Task[]>((drafts, step) => {
    const title = step.title.trim();
    if (!title || usedTitles.has(taskTitleKey(title))) return drafts;
    const baseId = stableId(`task-plan-${plan.version}-${step.order}`, title);
    const id = uniqueId(baseId, usedIds);
    usedIds.add(id);
    usedTitles.add(taskTitleKey(title));
    drafts.push({
      id,
      title,
      description: step.detail,
      branchId,
      status: "draft",
      dependencyIds: [],
      blockedBy: [],
      acceptanceCriteria: [step.outcome],
      provenance,
      approvalStatus,
      sourcePlanVersion: plan.version,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return drafts;
  }, []);
}

function incompleteDependencies(task: Task, byId: Map<string, Task>) {
  return task.dependencyIds.filter((dependencyId) => byId.get(dependencyId)?.status !== "done");
}

export function updateTaskStatus(
  tasks: Task[],
  taskId: string,
  nextStatus: TaskStatus,
): TaskStatusUpdateResult {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) {
    return { tasks, accepted: false, reason: `Task ${taskId} was not found.`, blockedBy: [] };
  }

  const byId = new Map(tasks.map((item) => [item.id, item]));
  const blockedBy = incompleteDependencies(task, byId);
  const requiresDependencies = nextStatus === "ready" || nextStatus === "in-progress" || nextStatus === "done";
  if (requiresDependencies && blockedBy.length > 0) {
    const reason = `Task is blocked until dependencies are complete: ${blockedBy.join(", ")}.`;
    const updatedTasks = tasks.map((item) =>
      item.id === taskId ? { ...item, status: "blocked" as const, blockedBy, updatedAt: item.updatedAt } : item,
    );
    return { tasks: updatedTasks, accepted: false, reason, blockedBy };
  }

  const updatedTasks = tasks.map((item) =>
    item.id === taskId ? { ...item, status: nextStatus, blockedBy: [], updatedAt: item.updatedAt } : item,
  );
  return {
    tasks: updatedTasks,
    accepted: true,
    reason: `Task status updated to ${nextStatus}.`,
    blockedBy: [],
  };
}

const IMPACT_RULES: Record<BranchTemplate, { terms: string[]; action: string }> = {
  "product-strategy": {
    terms: ["user", "audience", "problem", "scope", "requirement", "goal", "journey"],
    action: "Re-check the user outcome, scope, and open discovery questions.",
  },
  "market-research": {
    terms: ["market", "competitor", "customer", "audience", "alternative", "demand", "research"],
    action: "Review the evidence question, competitors, audience assumptions, and research sources.",
  },
  "development-architecture": {
    terms: ["architecture", "stack", "database", "data", "auth", "offline", "api", "security", "technical"],
    action: "Review technical decisions, dependencies, and the smallest foundation that supports the change.",
  },
  "ui-ux-design": {
    terms: ["screen", "interface", "design", "accessibility", "ux", "ui", "workflow"],
    action: "Review the affected user experience, interface states, and accessibility criteria.",
  },
  "marketing-growth": {
    terms: ["marketing", "growth", "positioning", "acquisition", "launch", "channel", "audience"],
    action: "Review positioning, messaging, acquisition experiments, and success signals.",
  },
  "finance-budget": {
    terms: ["budget", "cost", "price", "pricing", "revenue", "subscription", "spend"],
    action: "Review cost drivers, pricing assumptions, and budget impact before approving the change.",
  },
  operations: {
    terms: ["operations", "deploy", "deployment", "hosting", "monitor", "support", "release"],
    action: "Review release, operating, monitoring, and handover implications.",
  },
  "legal-compliance": {
    terms: ["legal", "privacy", "security", "compliance", "policy", "consent", "data"],
    action: "Review privacy, security, policy, and compliance implications with appropriate expertise.",
  },
  "customer-support": {
    terms: ["support", "customer", "feedback", "ticket", "help", "service"],
    action: "Review support workflows, feedback capture, and service recovery implications.",
  },
  automation: {
    terms: ["automation", "schedule", "workflow", "trigger", "reminder", "notify"],
    action: "Review automation permissions, idempotency, approvals, and execution limits.",
  },
};

export function computeBranchImpactSuggestions(
  branches: ProjectBranch[],
  changedRequirement: string,
): BranchImpactSuggestion[] {
  const normalizedRequirement = changedRequirement.trim().toLocaleLowerCase();
  return branches.map((branch) => {
    const rule = IMPACT_RULES[branch.template];
    const matches = rule.terms.filter((term) => normalizedRequirement.includes(term));
    const impact: BranchImpactSuggestion["impact"] = matches.length >= 2 ? "high" : matches.length === 1 ? "medium" : "low";
    const reason = matches.length
      ? `The change mentions ${matches.join(", ")}, which maps to ${branch.name}.`
      : `${branch.name} has no direct keyword match, but should be checked for downstream effects.`;
    return {
      branchId: branch.id,
      branchName: branch.name,
      impact,
      reason,
      suggestedAction: rule.action,
      provenance: "deterministic",
      approvalStatus: "pending",
    };
  });
}

const SAFE_AUTOMATION_TEMPLATES: readonly AutomationDefinition[] = [
  {
    id: "automation-review-requirement",
    name: "Review requirement impact",
    description: "Create a manual review checklist for branches affected by a changed requirement.",
    trigger: "manual",
    executionMode: "manual-only",
    status: "available",
    steps: [
      { id: "identify", label: "Identify affected branches", description: "Compare the requirement with branch responsibilities.", requiresApproval: false },
      { id: "review", label: "Review suggested changes", description: "A person confirms or rejects the suggested updates.", requiresApproval: true },
    ],
    safetyNotes: ["This template only prepares a review; it does not edit project files or schedule work."],
    provenance: "deterministic",
    approvalStatus: "approved",
  },
  {
    id: "automation-plan-tasks",
    name: "Draft tasks from the current plan",
    description: "Turn roadmap steps into reviewable task drafts without starting execution.",
    trigger: "manual",
    executionMode: "manual-only",
    status: "available",
    steps: [
      { id: "draft", label: "Draft tasks", description: "Create de-duplicated task records from the current solution plan.", requiresApproval: false },
      { id: "approve", label: "Approve tasks", description: "A person reviews task scope and dependencies.", requiresApproval: true },
    ],
    safetyNotes: ["Task drafts remain pending approval and are never presented as scheduled execution."],
    provenance: "deterministic",
    approvalStatus: "approved",
  },
] as const;

export function getSafeAutomationTemplates(): AutomationDefinition[] {
  return SAFE_AUTOMATION_TEMPLATES.map((template) => ({
    ...template,
    steps: template.steps.map((step) => ({ ...step })),
    safetyNotes: [...template.safetyNotes],
  }));
}

export function createManualAutomationRun(
  automation: AutomationDefinition,
  output: string[] = [],
): AutomationRun {
  const hasApproval = automation.approvalStatus === "approved";
  const status = automation.status === "available" && hasApproval ? "completed" : "blocked";
  return {
    id: stableId("automation-run", automation.id),
    automationId: automation.id,
    status,
    trigger: "manual",
    executionMode: "manual-only",
    scheduled: false,
    summary: status === "completed"
      ? "Manual dry run recorded. No scheduled execution was created."
      : "Manual run was blocked because the automation is not approved and available.",
    output: [...output],
    provenance: "deterministic",
    approvalStatus: status === "completed" ? "approved" : "pending",
  };
}

function contextValues(context: DiscoveryContext): Partial<Record<DiscoveryField, unknown>> {
  if ("request" in context) {
    return {
      idea: context.request.idea,
      category: context.request.category,
      budgetInr: context.request.budgetInr,
      experienceLevel: context.request.experienceLevel,
      preferredTechnologies: context.request.preferredTechnologies,
      deploymentPreference: context.request.deploymentPreference === "Not decided yet" ? undefined : context.request.deploymentPreference,
      constraints: context.request.additionalRequirements,
    };
  }
  return context;
}

const DISCOVERY_PROMPTS: Array<Pick<DiscoveryQuestion, "field" | "prompt" | "rationale" | "required" | "priority">> = [
  { field: "idea", prompt: "What are you trying to make or change?", rationale: "A concrete outcome anchors every later decision.", required: true, priority: 1 },
  { field: "audience", prompt: "Who is the first person or team this should help?", rationale: "The first audience keeps scope and language testable.", required: true, priority: 2 },
  { field: "firstUserJourney", prompt: "What is the smallest successful first user journey?", rationale: "A thin journey turns a broad idea into an observable slice.", required: true, priority: 3 },
  { field: "successMetric", prompt: "How will you know the first version is useful?", rationale: "A success signal makes validation concrete.", required: false, priority: 4 },
  { field: "budgetInr", prompt: "What maximum budget should guide the first release?", rationale: "Cost limits affect provider, hosting, and scope choices.", required: false, priority: 5 },
  { field: "deploymentPreference", prompt: "Where should the first usable version run?", rationale: "Deployment constraints shape the foundation and delivery work.", required: false, priority: 6 },
  { field: "preferredTechnologies", prompt: "Are there technologies you want to use or avoid?", rationale: "Known preferences should be explicit before the stack is reviewed.", required: false, priority: 7 },
  { field: "constraints", prompt: "What important constraints or non-goals should be recorded?", rationale: "Explicit boundaries prevent accidental scope expansion.", required: false, priority: 8 },
];

function isProvided(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function createProgressiveDiscoveryQuestions(
  context: DiscoveryContext,
  answers: DiscoveryAnswer[] = [],
): DiscoveryQuestion[] {
  const provided = contextValues(context);
  const answeredFields = new Set(
    answers.filter((answer) => answer.status !== "rejected" && isProvided(answer.value)).map((answer) => answer.field),
  );
  return DISCOVERY_PROMPTS
    .filter((question) => !isProvided(provided[question.field]) && !answeredFields.has(question.field))
    .slice(0, 4)
    .map((question) => ({
      ...question,
      id: stableId("discovery", question.field),
      status: "open" as const,
      provenance: "deterministic" as const,
      approvalStatus: "pending" as const,
    }));
}

export function createDiscoveryAnswer(
  question: DiscoveryQuestion,
  value: string,
  provenance: OperatingSystemProvenance = "user",
): DiscoveryAnswer {
  return {
    id: stableId("answer", `${question.id}-${value}`),
    questionId: question.id,
    field: question.field,
    value: value.trim(),
    status: "provided",
    provenance,
    approvalStatus: "pending",
  };
}

export function projectWorkspaceContext(workspace: ProjectWorkspace): DiscoveryContext {
  return workspace;
}
