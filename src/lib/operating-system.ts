import type { ProjectWorkspace } from "@/types/workspace";
import type { SolutionPlan } from "@/types/solution";
import type { WorkspaceMessage } from "@/types/workspace";
import {
  BRANCH_STATUSES,
  BRANCH_TEMPLATES,
  DEFAULT_BRANCH_TEMPLATES,
  type ApprovalStatus,
  type AutomationDefinition,
  type AutomationRun,
  type BranchDraft,
  type BranchEdge,
  type BranchEdgeRelationship,
  type BranchImpactSuggestion,
  type CanvasPosition,
  type CanvasViewport,
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
const BRANCH_EDGE_RELATIONSHIPS: readonly BranchEdgeRelationship[] = ["depends-on", "informs", "blocks", "related-to"];

/** Keep persisted canvas state finite and bounded even when it comes from old local records. */
export const CANVAS_COORDINATE_LIMIT = 100_000;
export const CANVAS_MIN_ZOOM = 0.1;
export const CANVAS_MAX_ZOOM = 4;

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function isValidCanvasPosition(value: unknown): value is CanvasPosition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isFiniteInRange(candidate.x, -CANVAS_COORDINATE_LIMIT, CANVAS_COORDINATE_LIMIT)
    && isFiniteInRange(candidate.y, -CANVAS_COORDINATE_LIMIT, CANVAS_COORDINATE_LIMIT);
}

export function isValidCanvasViewport(value: unknown): value is CanvasViewport {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isFiniteInRange(candidate.zoom, CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM)
    && isValidCanvasPosition(candidate.pan);
}

function normalizedCanvasPosition(value: unknown): CanvasPosition | undefined {
  return isValidCanvasPosition(value) ? { x: value.x, y: value.y } : undefined;
}

function normalizedCanvasViewport(value: unknown): CanvasViewport | undefined {
  return isValidCanvasViewport(value)
    ? { zoom: value.zoom, pan: { x: value.pan.x, y: value.pan.y } }
    : undefined;
}

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
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
}

function templateDefinition(template: BranchTemplate) {
  return DEFAULT_BRANCH_TEMPLATES.find((item) => item.template === template) ?? DEFAULT_BRANCH_TEMPLATES[0];
}

function branchTemplate(value: unknown): BranchTemplate {
  return BRANCH_TEMPLATES.includes(value as BranchTemplate) ? value as BranchTemplate : "development-architecture";
}

function branchStatus(value: unknown): ProjectBranch["status"] {
  return BRANCH_STATUSES.includes(value as ProjectBranch["status"]) ? value as ProjectBranch["status"] : "active";
}

function provenance(value: unknown, fallback: OperatingSystemProvenance): OperatingSystemProvenance {
  return value === "user" || value === "system" || value === "deterministic" || value === "model-assisted" || value === "web-researched" || value === "imported"
    ? value
    : fallback;
}

function approvalStatus(value: unknown): ApprovalStatus {
  return value === "approved" || value === "rejected" || value === "pending" ? value : "pending";
}

function normalizeBranchEdges(value: unknown, trustedBranchIds: Set<string>): BranchEdge[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  return value.flatMap((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null) return [];
    const source = candidate as Record<string, unknown>;
    const id = typeof source.id === "string" && source.id.trim()
      ? source.id.trim()
      : `edge-${index + 1}`;
    const fromBranchId = typeof source.fromBranchId === "string" ? source.fromBranchId.trim() : "";
    const toBranchId = typeof source.toBranchId === "string" ? source.toBranchId.trim() : "";
    const relationship = source.relationship as BranchEdgeRelationship;
    if (
      !trustedBranchIds.has(fromBranchId) ||
      !trustedBranchIds.has(toBranchId) ||
      fromBranchId === toBranchId ||
      !BRANCH_EDGE_RELATIONSHIPS.includes(relationship) ||
      (source.status !== "active" && source.status !== "archived")
    ) return [];
    const normalizedId = uniqueId(id, usedIds);
    usedIds.add(normalizedId);
    return [{
      ...source,
      id: normalizedId,
      fromBranchId,
      toBranchId,
      relationship,
      status: source.status,
      provenance: provenance(source.provenance, "user"),
      approvalStatus: approvalStatus(source.approvalStatus),
      rationale: typeof source.rationale === "string" ? source.rationale : "",
    } as BranchEdge];
  });
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
  const template = branchTemplate(draft.template ?? "development-architecture");
  const definition = templateDefinition(template);
  const workspaceId = draft.workspaceId ?? branches[0]?.workspaceId ?? "workspace";
  const baseId = draft.id ?? stableId(`${workspaceId}-branch`, draft.name);
  const id = uniqueId(baseId, new Set(branches.map((branch) => branch.id)));
  const timestamp = draft.timestamp ?? DEFAULT_TIMESTAMP;
  const parentBranchId = typeof draft.parentBranchId === "string" ? draft.parentBranchId.trim() : "";
  const parent = parentBranchId
    ? branches.find((branch) => branch.id === parentBranchId && branch.workspaceId === workspaceId)
    : undefined;
  const canvasPosition = normalizedCanvasPosition(draft.canvasPosition);

  return {
    id,
    workspaceId,
    name: nonEmpty(draft.name, definition.name),
    template,
    description: nonEmpty(draft.description, definition.description),
    status: draft.status ?? "active",
    provenance: draft.provenance ?? "user",
    approvalStatus: draft.approvalStatus ?? "pending",
    ...(parent && parent.id !== id ? { parentBranchId: parent.id } : {}),
    ...(canvasPosition ? { canvasPosition } : {}),
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
  const baseline = initializeOperatingSystem(workspace);
  const sourceBranches = existing && Array.isArray(existing.branches) && existing.branches.length > 0
    ? existing.branches
    : baseline.branches;
  const usedBranchIds = new Set<string>();
  const normalizedBranches = sourceBranches.map((source, index) => {
    const sourceRecord = source as unknown as Record<string, unknown>;
    const template = branchTemplate(source.template);
    const definition = templateDefinition(template);
    const sourceName = typeof source.name === "string" ? source.name : "";
    const sourceId = typeof source.id === "string" && source.id.trim() ? source.id.trim() : `${workspace.id}-branch-${slug(sourceName || `branch-${index + 1}`)}`;
    const id = uniqueId(sourceId, usedBranchIds);
    usedBranchIds.add(id);
    const sourceWorkspaceId = typeof source.workspaceId === "string" && source.workspaceId.trim() ? source.workspaceId : workspace.id;
    const canvasPosition = normalizedCanvasPosition(sourceRecord.canvasPosition);
    const sourceWithoutCanvasPosition = { ...source };
    delete sourceWithoutCanvasPosition.canvasPosition;
    return {
      ...sourceWithoutCanvasPosition,
      id,
      workspaceId: sourceWorkspaceId,
      name: nonEmpty(source.name, definition.name),
      template,
      description: nonEmpty(source.description, definition.description),
      status: branchStatus(source.status),
      provenance: provenance(source.provenance, "user"),
      approvalStatus: approvalStatus(source.approvalStatus),
      parentBranchId: typeof source.parentBranchId === "string" && source.parentBranchId.trim() ? source.parentBranchId.trim() : undefined,
      messages: Array.isArray(source.messages) ? source.messages : [],
      requirements: Array.isArray(source.requirements) ? source.requirements.filter((item): item is string => typeof item === "string") : [],
      researchFindingIds: Array.isArray(source.researchFindingIds) ? source.researchFindingIds.filter((item): item is string => typeof item === "string") : [],
      decisionIds: Array.isArray(source.decisionIds) ? source.decisionIds.filter((item): item is string => typeof item === "string") : [],
      taskIds: Array.isArray(source.taskIds) ? source.taskIds.filter((item): item is string => typeof item === "string") : [],
      createdAt: typeof source.createdAt === "string" && source.createdAt ? source.createdAt : workspace.createdAt || DEFAULT_TIMESTAMP,
      updatedAt: typeof source.updatedAt === "string" && source.updatedAt ? source.updatedAt : workspace.updatedAt || workspace.createdAt || DEFAULT_TIMESTAMP,
      ...(canvasPosition ? { canvasPosition } : {}),
    } satisfies ProjectBranch;
  });

  // Only branches belonging to this workspace may become trusted parents. A
  // malformed legacy record can still be returned for inspection, but its
  // parent link is detached rather than allowing a foreign record into context.
  const trustedBranchIds = new Set(
    normalizedBranches.filter((branch) => branch.workspaceId === workspace.id).map((branch) => branch.id),
  );
  const sourceBranchWorkspaceById = new Map<string, string | null>();
  sourceBranches.forEach((source, index) => {
    const sourceId = typeof source.id === "string" ? source.id.trim() : "";
    const normalizedBranch = normalizedBranches[index];
    if (!sourceId || !normalizedBranch) return;
    const previousWorkspaceId = sourceBranchWorkspaceById.get(sourceId);
    if (previousWorkspaceId === undefined) {
      sourceBranchWorkspaceById.set(sourceId, normalizedBranch.workspaceId);
    } else if (previousWorkspaceId !== normalizedBranch.workspaceId) {
      sourceBranchWorkspaceById.set(sourceId, null);
    }
  });
  const trustedSourceBranchIds = new Map<string, string>();
  sourceBranches.forEach((source, index) => {
    const normalizedBranch = normalizedBranches[index];
    if (!normalizedBranch || normalizedBranch.workspaceId !== workspace.id) return;
    const sourceId = typeof source.id === "string" ? source.id.trim() : "";
    if (sourceId && sourceBranchWorkspaceById.get(sourceId) === workspace.id && !trustedSourceBranchIds.has(sourceId)) {
      trustedSourceBranchIds.set(sourceId, normalizedBranch.id);
    }
  });
  const branchesWithTrustedParents = normalizedBranches.map((branch) => {
    const rawParentId = typeof branch.parentBranchId === "string" ? branch.parentBranchId.trim() : "";
    const parentId = branch.workspaceId === workspace.id
      ? trustedSourceBranchIds.get(rawParentId) ?? (trustedBranchIds.has(rawParentId) ? rawParentId : "")
      : "";
    return parentId && parentId !== branch.id
      ? { ...branch, parentBranchId: parentId }
      : { ...branch, parentBranchId: undefined };
  });
  const parentById = new Map(branchesWithTrustedParents.map((branch) => [branch.id, branch]));
  const branches = branchesWithTrustedParents.map((branch) => {
    if (!branch.parentBranchId) return branch;
    const seen = new Set<string>([branch.id]);
    let parentId: string | undefined = branch.parentBranchId;
    while (parentId) {
      if (seen.has(parentId)) return { ...branch, parentBranchId: undefined };
      seen.add(parentId);
      const parent = parentById.get(parentId);
      if (!parent || parent.workspaceId !== workspace.id) return { ...branch, parentBranchId: undefined };
      parentId = parent.parentBranchId;
    }
    return branch;
  });
  const branchIdByTemplate = new Map<string, string>();
  sourceBranches.forEach((source, index) => {
    const normalizedBranch = branches[index];
    if (!normalizedBranch || normalizedBranch.workspaceId !== workspace.id) return;
    if (typeof source.template === "string") branchIdByTemplate.set(source.template, normalizedBranch.id);
    branchIdByTemplate.set(normalizedBranch.template, normalizedBranch.id);
  });
  const sourceTasks = existing && Array.isArray(existing.tasks) ? existing.tasks : baseline.tasks;
  const tasks = sourceTasks.map((task) => {
    const branchId = typeof task.branchId === "string" ? task.branchId : "";
    const migratedBranchId = trustedBranchIds.has(branchId) ? branchId : branchIdByTemplate.get(branchId);
    return {
      ...task,
      ...(migratedBranchId && migratedBranchId !== branchId ? { branchId: migratedBranchId } : {}),
      dependencyIds: Array.isArray(task.dependencyIds) ? task.dependencyIds.filter((item): item is string => typeof item === "string") : [],
      blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy.filter((item): item is string => typeof item === "string") : [],
    };
  });

  const existingRecord = existing as unknown as Record<string, unknown> | undefined;
  const existingWithoutCanvasViewport: Partial<ProjectOperatingSystem> = existing ? { ...existing } : {};
  delete existingWithoutCanvasViewport.viewport;
  delete existingWithoutCanvasViewport.canvasViewport;
  const viewport = normalizedCanvasViewport(existingRecord?.viewport)
    ?? normalizedCanvasViewport(existingRecord?.canvasViewport);
  const milestones = Array.isArray(existing?.milestones)
    ? existing.milestones.map((milestone) => ({
        ...milestone,
        taskIds: Array.isArray(milestone.taskIds) ? milestone.taskIds.filter((item): item is string => typeof item === "string") : [],
      }))
    : baseline.milestones;
  const decisions = Array.isArray(existing?.decisions)
    ? existing.decisions.map((decision) => ({
        ...decision,
        relatedBranchIds: Array.isArray(decision.relatedBranchIds)
          ? decision.relatedBranchIds.filter((item): item is string => typeof item === "string")
          : [],
      }))
    : baseline.decisions;
  const taskIds = new Set(tasks.map((task) => task.id));
  const decisionIds = new Set(decisions.map((decision) => decision.id));
  const branchesWithSafeReferences = branches.map((branch) => ({
    ...branch,
    taskIds: branch.taskIds.filter((taskId) => taskIds.has(taskId)),
    decisionIds: branch.decisionIds.filter((decisionId) => decisionIds.has(decisionId)),
  }));
  const edges = normalizeBranchEdges(existing?.edges ?? baseline.edges, new Set(branchesWithSafeReferences.map((branch) => branch.id).filter((id) => trustedBranchIds.has(id))));

  return {
    ...workspace,
    operatingSystem: {
      ...baseline,
      ...existingWithoutCanvasViewport,
      branchImpactSuggestions: Array.isArray(existing?.branchImpactSuggestions) ? existing.branchImpactSuggestions : [],
      branches: branchesWithSafeReferences,
      edges,
      tasks,
      milestones,
      automations: Array.isArray(existing?.automations) ? existing.automations : baseline.automations,
      automationRuns: Array.isArray(existing?.automationRuns) ? existing.automationRuns : baseline.automationRuns,
      discoveryQuestions: Array.isArray(existing?.discoveryQuestions) ? existing.discoveryQuestions : baseline.discoveryQuestions,
      discoveryAnswers: Array.isArray(existing?.discoveryAnswers) ? existing.discoveryAnswers : baseline.discoveryAnswers,
      decisions,
      preferences: existing?.preferences ?? baseline.preferences,
      ...(viewport ? { viewport } : {}),
    },
  };
}

/**
 * Return the active branch followed by its parent chain and one-hop connected
 * branches. Invalid or stale references are ignored so legacy records remain
 * readable without turning untrusted IDs into context.
 */
export function getBranchContextBranches(
  operatingSystem: ProjectOperatingSystem,
  branchId: string,
): ProjectBranch[] {
  const active = operatingSystem.branches.find((branch) => branch.id === branchId);
  if (!active) return [];
  const byId = new Map(
    operatingSystem.branches
      .filter((branch) => branch.workspaceId === active.workspaceId)
      .map((branch) => [branch.id, branch]),
  );
  if (!byId.has(active.id)) return [];

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (!seen.has(id) && byId.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  };

  let current: ProjectBranch | undefined = active;
  while (current) {
    add(current.id);
    if (!current.parentBranchId || current.parentBranchId === current.id || seen.has(current.parentBranchId)) break;
    current = byId.get(current.parentBranchId);
  }

  const parentAndActiveIds = new Set(orderedIds);
  for (const edge of operatingSystem.edges) {
    if (edge.status !== "active") continue;
    if (parentAndActiveIds.has(edge.fromBranchId)) add(edge.toBranchId);
    if (parentAndActiveIds.has(edge.toBranchId)) add(edge.fromBranchId);
  }

  return orderedIds.map((id) => byId.get(id)).filter((branch): branch is ProjectBranch => Boolean(branch));
}

export type BranchEdgeUpdate = Partial<Pick<
  BranchEdge,
  "fromBranchId" | "toBranchId" | "relationship" | "status" | "provenance" | "approvalStatus" | "rationale"
>>;

/**
 * Remove a branch and all of its descendants without leaving references to
 * deleted tasks, milestones, decisions, or edges. Research evidence lives on
 * the workspace, so it is deliberately not touched by this helper.
 */
export function removeBranchTree(
  operatingSystem: ProjectOperatingSystem,
  branchId: string,
): ProjectOperatingSystem {
  const root = operatingSystem.branches.find((branch) => branch.id === branchId);
  if (!root) return operatingSystem;

  const removedBranchIds = new Set<string>([root.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const branch of operatingSystem.branches) {
      if (
        branch.workspaceId === root.workspaceId &&
        branch.parentBranchId &&
        removedBranchIds.has(branch.parentBranchId) &&
        !removedBranchIds.has(branch.id)
      ) {
        removedBranchIds.add(branch.id);
        changed = true;
      }
    }
  }

  const survivingBranches = operatingSystem.branches.filter((branch) => !removedBranchIds.has(branch.id));
  const survivingBranchIds = new Set(survivingBranches.map((branch) => branch.id));
  const removedTaskIds = new Set(
    operatingSystem.tasks
      .filter((task) => removedBranchIds.has(task.branchId))
      .map((task) => task.id),
  );
  const survivingTasks = operatingSystem.tasks.filter(
    (task) => survivingBranchIds.has(task.branchId) && !removedTaskIds.has(task.id),
  );
  const survivingTaskIds = new Set(survivingTasks.map((task) => task.id));
  const survivingMilestones = operatingSystem.milestones
    .filter((milestone) => survivingBranchIds.has(milestone.branchId))
    .map((milestone) => ({
      ...milestone,
      taskIds: milestone.taskIds.filter((taskId) => survivingTaskIds.has(taskId)),
    }));
  const survivingMilestoneIds = new Set(survivingMilestones.map((milestone) => milestone.id));
  const survivingDecisionIds = new Set(operatingSystem.decisions.map((decision) => decision.id));
  const branches = survivingBranches.map((branch) => ({
    ...branch,
    parentBranchId: branch.parentBranchId && survivingBranchIds.has(branch.parentBranchId)
      ? branch.parentBranchId
      : undefined,
    taskIds: branch.taskIds.filter((taskId) => survivingTaskIds.has(taskId)),
    decisionIds: branch.decisionIds.filter((decisionId) => survivingDecisionIds.has(decisionId)),
  }));
  const tasks = survivingTasks.map((task) => ({
    ...task,
    dependencyIds: task.dependencyIds.filter((dependencyId) => survivingTaskIds.has(dependencyId)),
    blockedBy: task.blockedBy.filter((taskId) => survivingTaskIds.has(taskId)),
    ...(task.milestoneId && survivingMilestoneIds.has(task.milestoneId)
      ? { milestoneId: task.milestoneId }
      : { milestoneId: undefined }),
  }));
  const decisions = operatingSystem.decisions.map((decision) => ({
    ...decision,
    relatedBranchIds: decision.relatedBranchIds.filter((relatedBranchId) => survivingBranchIds.has(relatedBranchId)),
  }));

  return {
    ...operatingSystem,
    branches,
    edges: operatingSystem.edges.filter(
      (edge) => survivingBranchIds.has(edge.fromBranchId) && survivingBranchIds.has(edge.toBranchId),
    ),
    tasks,
    milestones: survivingMilestones,
    decisions,
    branchImpactSuggestions: operatingSystem.branchImpactSuggestions.filter(
      (suggestion) => survivingBranchIds.has(suggestion.branchId),
    ),
  };
}

/** Update one edge only when its new endpoints remain valid and same-project. */
export function updateBranchEdge(
  operatingSystem: ProjectOperatingSystem,
  edgeId: string,
  update: BranchEdgeUpdate,
): ProjectOperatingSystem {
  const edge = operatingSystem.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return operatingSystem;

  const fromBranchId = update.fromBranchId ?? edge.fromBranchId;
  const toBranchId = update.toBranchId ?? edge.toBranchId;
  const relationship = update.relationship ?? edge.relationship;
  const status = update.status ?? edge.status;
  const provenanceValue = update.provenance ?? edge.provenance;
  const approvalValue = update.approvalStatus ?? edge.approvalStatus;
  const rationale = update.rationale ?? edge.rationale;
  const fromBranch = operatingSystem.branches.find((branch) => branch.id === fromBranchId);
  const toBranch = operatingSystem.branches.find((branch) => branch.id === toBranchId);
  if (
    typeof fromBranchId !== "string" || !fromBranchId.trim() ||
    typeof toBranchId !== "string" || !toBranchId.trim() ||
    fromBranchId === toBranchId ||
    !fromBranch || !toBranch || fromBranch.workspaceId !== toBranch.workspaceId ||
    !BRANCH_EDGE_RELATIONSHIPS.includes(relationship) ||
    (status !== "active" && status !== "archived") ||
    (provenanceValue !== "user" && provenanceValue !== "system" && provenanceValue !== "deterministic" && provenanceValue !== "model-assisted" && provenanceValue !== "web-researched" && provenanceValue !== "imported") ||
    (approvalValue !== "approved" && approvalValue !== "rejected" && approvalValue !== "pending") ||
    typeof rationale !== "string"
  ) {
    return operatingSystem;
  }

  const duplicate = status === "active" && operatingSystem.edges.some(
    (candidate) => candidate.id !== edgeId &&
      candidate.status === "active" &&
      candidate.fromBranchId === fromBranchId &&
      candidate.toBranchId === toBranchId &&
      candidate.relationship === relationship,
  );
  if (duplicate) return operatingSystem;

  const updatedEdge: BranchEdge = {
    ...edge,
    fromBranchId,
    toBranchId,
    relationship,
    status,
    provenance: provenanceValue,
    approvalStatus: approvalValue,
    rationale: rationale.trim(),
  };
  return {
    ...operatingSystem,
    edges: operatingSystem.edges.map((candidate) => candidate.id === edgeId ? updatedEdge : candidate),
  };
}

/** Remove an edge by id without touching branches or shared research records. */
export function removeBranchEdge(
  operatingSystem: ProjectOperatingSystem,
  edgeId: string,
): ProjectOperatingSystem {
  if (!operatingSystem.edges.some((edge) => edge.id === edgeId)) return operatingSystem;
  return {
    ...operatingSystem,
    edges: operatingSystem.edges.filter((edge) => edge.id !== edgeId),
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
  if (!fromBranchId || !toBranchId || fromBranchId === toBranchId || !BRANCH_EDGE_RELATIONSHIPS.includes(relationship)) return edges;
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
