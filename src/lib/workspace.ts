import type { ProjectRequest } from "@/types/project";
import type { ResearchAssessment, ResearchClaim, ResearchEvidence, ResearchFinding, ResearchSource } from "@/types/research";
import type { WorkspaceMessage, ProjectMemory, ProjectWorkspace, WorkspaceRequestPatch } from "@/types/workspace";
import { normalizeResearchUrl } from "./research/evidence";

import { generateSolutionPlan } from "./recommendations";
import { computeBranchImpactSuggestions, ensureOperatingSystem } from "./operating-system";

export function createStableId(prefix = "project") {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return new Date().toISOString();
}

function projectName(request: ProjectRequest) {
  const words = request.idea.trim().split(/\s+/).slice(0, 7).join(" ");
  return words ? words.replace(/[.!?]+$/, "") : "Untitled project";
}

function message(
  role: WorkspaceMessage["role"],
  content: string,
  source: WorkspaceMessage["source"],
): WorkspaceMessage {
  return {
    id: createStableId("message"),
    role,
    content,
    createdAt: now(),
    source,
  };
}

function initialMemory(request: ProjectRequest, openQuestions: string[], planVersion: number): ProjectMemory {
  const constraints = [
    request.budgetInr === null ? "Budget not specified" : `Budget: ₹${request.budgetInr}`,
    `Experience: ${request.experienceLevel}`,
    `Deployment: ${request.deploymentPreference}`,
    ...(request.preferredTechnologies.length
      ? [`Preferred technologies: ${request.preferredTechnologies.join(", ")}`]
      : ["No technology preference specified"]),
  ];

  return {
    confirmedRequirements: [request.idea.trim(), ...constraints],
    userPreferences: request.preferredTechnologies,
    technologyDecisions: [],
    rejectedAlternatives: [],
    openQuestions,
    recentSummary: "Project brief captured. No conversation updates yet.",
    currentPlanVersion: planVersion,
  };
}

export function createProjectWorkspace(request: ProjectRequest): ProjectWorkspace {
  const plan = generateSolutionPlan(request, 1);
  const createdAt = now();
  const welcome = [
    `I’ve captured your brief for “${projectName(request)}”.`,
    "",
    "I’m starting with a reviewable baseline from the curated catalogue. It is a decision aid, not a live AI recommendation or verified price quote.",
    `The initial direction is: ${plan.summary}`,
    "",
    plan.openQuestions.length
      ? `The first question I’d like to clarify is: ${plan.openQuestions[0]}`
      : "The next useful step is to lock the first user journey before adding more tools.",
    "",
    "You can challenge any decision, edit the brief, or ask me to compare an alternative."
  ].join("\n");

  return ensureOperatingSystem({
    id: createStableId(),
    name: projectName(request),
    request,
    messages: [message("assistant", welcome, "deterministic-fallback")],
    memory: initialMemory(request, plan.openQuestions, plan.version),
    researchFindings: [],
    researchSources: [],
    researchEvidence: [],
    researchClaims: [],
    plan,
    createdAt,
    updatedAt: createdAt,
  });
}

function requirementSignals(content: string) {
  const normalized = content.trim();
  if (!normalized) return [];

  const signals: string[] = [];
  if (/\b(must|need|needs|required|should|important)\b/i.test(normalized)) {
    signals.push(normalized);
  }
  if (/\b(offline|local[- ]first|without internet)\b/i.test(normalized)) {
    signals.push("Offline or local-first behavior is a confirmed concern.");
  }
  return signals;
}

export function appendWorkspaceMessage(
  workspace: ProjectWorkspace,
  nextMessage: WorkspaceMessage,
): ProjectWorkspace {
  const updatedRequirements =
    nextMessage.role === "user" ? requirementSignals(nextMessage.content) : [];
  const recentSummary =
    nextMessage.role === "user"
      ? `Latest user message: ${nextMessage.content.trim().slice(0, 240)}`
      : `Latest assistant response recorded from ${nextMessage.source}.`;

  return ensureOperatingSystem({
    ...workspace,
    messages: [...workspace.messages, nextMessage].slice(-80),
    memory: {
      ...workspace.memory,
      confirmedRequirements: [
        ...workspace.memory.confirmedRequirements,
        ...updatedRequirements,
      ].filter((value, index, values) => values.indexOf(value) === index).slice(-30),
      recentSummary,
    },
    updatedAt: now(),
  });
}

export function applyWorkspaceRequestPatch(
  workspace: ProjectWorkspace,
  patch: WorkspaceRequestPatch,
): ProjectWorkspace {
  const request: ProjectRequest = { ...workspace.request, ...patch };
  const nextVersion = workspace.plan.version + 1;
  const plan = generateSolutionPlan(request, nextVersion);
  const changeSummary = [
    patch.category ? `category → ${patch.category}` : null,
    patch.budgetInr !== undefined ? `budget → ${patch.budgetInr === null ? "not specified" : `₹${patch.budgetInr}`}` : null,
    patch.experienceLevel ? `experience → ${patch.experienceLevel}` : null,
    patch.deploymentPreference ? `deployment → ${patch.deploymentPreference}` : null,
    patch.preferredTechnologies ? `preferences → ${patch.preferredTechnologies.join(", ") || "none"}` : null,
    patch.idea ? "project idea updated" : null,
    patch.additionalRequirements !== undefined ? "requirements updated" : null,
  ].filter(Boolean).join("; ");

  const normalizedWorkspace = ensureOperatingSystem({
    ...workspace,
    name: projectName(request),
    request,
    plan,
    memory: {
      ...workspace.memory,
      userPreferences: request.preferredTechnologies,
      openQuestions: plan.openQuestions,
      currentPlanVersion: plan.version,
      recentSummary: `The brief was explicitly updated: ${changeSummary || "fields reviewed"}. The baseline plan was regenerated for review.`,
    },
    updatedAt: now(),
  });
  const changedRequirement = [patch.idea, patch.additionalRequirements, patch.category, patch.deploymentPreference]
    .filter(Boolean)
    .join(" ");
  if (!changedRequirement || !normalizedWorkspace.operatingSystem) return normalizedWorkspace;

  return {
    ...normalizedWorkspace,
    operatingSystem: {
      ...normalizedWorkspace.operatingSystem,
      branchImpactSuggestions: computeBranchImpactSuggestions(
        normalizedWorkspace.operatingSystem.branches,
        changedRequirement,
      ),
    },
  };
}

export function appendResearchFindings(
  workspace: ProjectWorkspace,
  findings: ProjectWorkspace["researchFindings"],
): ProjectWorkspace {
  const merged = [...workspace.researchFindings, ...findings].filter(
    (finding, index, all) => all.findIndex((item) => normalizeResearchUrl(item.url) === normalizeResearchUrl(finding.url)) === index,
  );

  return ensureOperatingSystem({
    ...workspace,
    researchFindings: merged.slice(-30),
    updatedAt: now(),
  });
}

export function appendResearchBundle(
  workspace: ProjectWorkspace,
  bundle: {
    findings: ResearchFinding[];
    sources?: ResearchSource[];
    evidence?: ResearchEvidence[];
    claims?: ResearchClaim[];
    assessment?: ResearchAssessment;
  },
): ProjectWorkspace {
  const next = appendResearchFindings(workspace, bundle.findings);
  const sourceById = new Map((next.researchSources ?? []).map((source) => [source.id, source]));
  for (const source of bundle.sources ?? []) sourceById.set(source.id, source);
  const evidenceById = new Map((next.researchEvidence ?? []).map((item) => [item.id, item]));
  for (const item of bundle.evidence ?? []) evidenceById.set(item.id, item);
  const claimById = new Map((next.researchClaims ?? []).map((claim) => [claim.id, claim]));
  for (const claim of bundle.claims ?? []) claimById.set(claim.id, claim);
  return {
    ...next,
    researchSources: [...sourceById.values()].slice(-100),
    researchEvidence: [...evidenceById.values()].slice(-100),
    researchClaims: [...claimById.values()].slice(-100),
    ...(bundle.assessment ? { researchAssessment: bundle.assessment } : {}),
  };
}
