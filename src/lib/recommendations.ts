import { getCatalogueTool, getRelevantCatalogueEntries } from "@/catalog";
import { TECHNOLOGY_CATALOGUE } from "@/catalog/data";
import type { CatalogueTool } from "@/catalog/types";
import type { ProjectRequest } from "@/types/project";
import type {
  CompatibilityCheck,
  PlanAlternative,
  PlanStackItem,
  SolutionPlan,
} from "@/types/solution";

const MAX_STACK_ITEMS = 12;

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function containsAny(text: string, terms: string[]) {
  const value = normalized(text);
  return terms.some((term) => value.includes(term));
}

function requestText(request: ProjectRequest) {
  return [
    request.idea,
    request.category,
    request.additionalRequirements,
    ...request.preferredTechnologies,
  ].join(" ");
}

function preferredToolIds(request: ProjectRequest) {
  const preferences = request.preferredTechnologies.map(normalized);
  return TECHNOLOGY_CATALOGUE.filter((tool) =>
    preferences.some(
      (preference) =>
        normalized(tool.name) === preference ||
        normalized(tool.id) === preference ||
        tool.tags.some((tag) => normalized(tag) === preference),
    ),
  ).map((tool) => tool.id);
}

function hasPreferred(request: ProjectRequest, values: string[]) {
  return request.preferredTechnologies.some((preference) =>
    values.some((value) => normalized(preference).includes(normalized(value))),
  );
}

function scoreTool(tool: CatalogueTool, request: ProjectRequest) {
  const text = requestText(request);
  const reasons: string[] = [];
  const tradeoffs: string[] = [];
  let score = 0;

  if (tool.suitableProjectTypes.includes(request.category)) {
    score += 18;
    reasons.push(`Fits a ${request.category.toLowerCase()} brief.`);
  }

  if (tool.skillLevels.includes(request.experienceLevel)) {
    score += 13;
    reasons.push(`Appropriate for an ${request.experienceLevel.toLowerCase()} builder.`);
  } else if (request.experienceLevel === "Beginner") {
    score -= 8;
    tradeoffs.push("This option may add concepts for a beginner.");
  }

  const matchedPreference = request.preferredTechnologies.find((preference) =>
    normalized(tool.name) === normalized(preference) ||
    tool.tags.some((tag) => normalized(tag) === normalized(preference)),
  );
  if (matchedPreference) {
    score += 34;
    reasons.push(`Matches the stated preference for ${matchedPreference}.`);
  }

  if (request.budgetInr === 0 || (request.budgetInr !== null && request.budgetInr <= 5000)) {
    if (tool.pricingModel === "open-source") {
      score += 13;
      reasons.push("Keeps the software cost signal low for a constrained budget.");
    } else if (tool.pricingModel === "usage-based" || tool.pricingModel === "paid") {
      score -= 7;
      tradeoffs.push("May introduce usage or subscription costs; verify current pricing.");
    }
  }

  if (request.deploymentPreference === "Local development only") {
    if (tool.category === "hosting") {
      score -= 30;
      tradeoffs.push("Not needed while the target is local development only.");
    }
    if (tool.id === "sqlite" || tool.id === "git") {
      score += 15;
      reasons.push("Works naturally with a local-first workflow.");
    }
  }

  if (request.deploymentPreference === "Deploy online" && tool.category === "hosting") {
    score += 20;
    reasons.push("Provides a direct path to online deployment.");
  }

  if (containsAny(text, ["offline", "local-first", "without internet", "on device"])) {
    if (tool.id === "sqlite" || tool.id === "vite") {
      score += 22;
      reasons.push("Supports an offline or local-first direction.");
    }
    if (tool.category === "hosting" || tool.id === "supabase" || tool.id === "firebase") {
      score -= 12;
      tradeoffs.push("A hosted dependency may conflict with offline-first behavior.");
    }
  }

  if (containsAny(text, ["ai", "llm", "chatbot", "recommendation", "generative"]) && tool.category === "ai-provider") {
    score += 25;
    reasons.push("Relevant to the requested AI capability.");
    tradeoffs.push("Requires server-side credentials and current usage-cost review.");
  }

  if (containsAny(text, ["login", "auth", "account", "sign in", "user profile"]) && tool.category === "authentication") {
    score += 18;
    reasons.push("Addresses an explicit identity or account requirement.");
  }

  if (containsAny(text, ["payment", "subscription", "sell", "checkout"]) && tool.id === "stripe") {
    score += 24;
    reasons.push("Matches the stated payment or commerce requirement.");
    tradeoffs.push("Payment compliance, webhooks, and transaction costs need review.");
  }

  if (containsAny(text, ["analytics", "measure", "events", "usage insights"]) && tool.category === "analytics") {
    score += 17;
    reasons.push("Matches an explicit measurement requirement.");
  }

  if (reasons.length === 0) {
    reasons.push("A reasonable catalogue candidate for the current project context.");
  }
  if (tradeoffs.length === 0) {
    tradeoffs.push("Confirm the latest documentation and project fit before committing.");
  }

  return { score, reasons, tradeoffs };
}

export function validateCatalogueCompatibility(toolIds: string[]): CompatibilityCheck[] {
  const checks: CompatibilityCheck[] = [];
  const uniqueIds = [...new Set(toolIds)];

  if (uniqueIds.length !== toolIds.length) {
    checks.push({
      status: "warning",
      summary: "The proposed stack contained a duplicate tool and was de-duplicated.",
      toolIds,
    });
  }

  for (let index = 0; index < uniqueIds.length; index += 1) {
    const first = getCatalogueTool(uniqueIds[index]);
    if (!first) {
      checks.push({
        status: "warning",
        summary: `Catalogue entry ${uniqueIds[index]} could not be found.`,
        toolIds: [uniqueIds[index]],
      });
      continue;
    }

    for (const secondId of uniqueIds.slice(index + 1)) {
      const second = getCatalogueTool(secondId);
      if (!second) continue;
      if (first.compatibility.conflictsWith.includes(second.id) || second.compatibility.conflictsWith.includes(first.id)) {
        checks.push({
          status: "warning",
          summary: `${first.name} and ${second.name} are marked as alternatives in the curated catalogue; choose one deliberately.`,
          toolIds: [first.id, second.id],
        });
      }
    }
  }

  if (!checks.some((check) => check.status === "warning")) {
    checks.push({
      status: "pass",
      summary: "No known hard conflict was found in the curated catalogue rules.",
      toolIds: uniqueIds,
    });
  }

  checks.push({
    status: "unknown",
    summary: "Runtime compatibility and current service limits still require project-specific verification.",
    toolIds: uniqueIds,
  });

  return checks;
}

function chooseTool(
  request: ProjectRequest,
  category: CatalogueTool["category"],
  excludedIds: string[] = [],
) {
  const candidates = getRelevantCatalogueEntries(request, TECHNOLOGY_CATALOGUE.length)
    .filter((tool) => tool.category === category && !excludedIds.includes(tool.id))
    .map((tool) => ({ tool, ...scoreTool(tool, request) }))
    .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name));

  return candidates[0] ?? null;
}

function chooseByIds(request: ProjectRequest, ids: string[], category?: CatalogueTool["category"]) {
  const candidates = ids
    .map((id) => getCatalogueTool(id))
    .filter((tool): tool is CatalogueTool => Boolean(tool))
    .filter((tool) => !category || tool.category === category)
    .map((tool) => {
      const scored = scoreTool(tool, request);
      return { tool, ...scored, score: scored.score + 100 };
    });

  return candidates.sort((left, right) => right.score - left.score)[0] ?? null;
}

function addSelection(
  selections: Map<string, ReturnType<typeof chooseTool> extends infer T ? T : never>,
  candidate: ReturnType<typeof chooseTool>,
) {
  if (candidate) selections.set(candidate.tool.id, candidate);
}

function chooseStack(request: ProjectRequest) {
  const text = requestText(request);
  const offline = containsAny(text, ["offline", "local-first", "without internet", "on device"]);
  const wantsAi = request.category === "AI application" || containsAny(text, ["ai", "llm", "chatbot", "generative"]);
  const wantsAuth = containsAny(text, ["login", "auth", "account", "sign in", "user profile"]) || request.category === "Online business";
  const wantsAnalytics = containsAny(text, ["analytics", "measure", "events", "usage insights"]);
  const wantsPayments = containsAny(text, ["payment", "subscription", "sell", "checkout"]);
  const pythonPreferred = hasPreferred(request, ["python", "fastapi"]) || containsAny(text, ["python-first", "python backend"]);
  const localOnly = request.deploymentPreference === "Local development only";
  const selections = new Map<string, ReturnType<typeof chooseTool>>();
  const preferredIds = preferredToolIds(request);

  const frontendCandidate = offline || hasPreferred(request, ["vite"])
    ? chooseByIds(request, preferredIds, "frontend") ?? chooseByIds(request, ["vite"], "frontend")
    : chooseByIds(request, preferredIds, "frontend") ?? chooseByIds(request, ["nextjs"], "frontend") ?? chooseTool(request, "frontend");
  addSelection(selections, frontendCandidate);

  if (pythonPreferred) {
    addSelection(selections, chooseByIds(request, ["python"], "language") ?? chooseTool(request, "language"));
    addSelection(selections, chooseByIds(request, ["fastapi"], "backend") ?? chooseTool(request, "backend"));
  } else {
    addSelection(selections, chooseByIds(request, ["typescript"], "language") ?? chooseTool(request, "language"));
    if (wantsAi || wantsAuth || containsAny(text, ["api", "backend", "data"])) {
      addSelection(selections, chooseByIds(request, ["node"], "backend") ?? chooseTool(request, "backend"));
    }
  }

  if (request.category !== "Portfolio website" || wantsAuth || wantsAi || offline) {
    if (offline || localOnly) {
      addSelection(selections, chooseByIds(request, ["sqlite"], "database") ?? chooseTool(request, "database"));
    } else if (hasPreferred(request, ["firebase"])) {
      addSelection(selections, chooseByIds(request, ["firebase"], "database"));
    } else if (hasPreferred(request, ["postgresql"])) {
      addSelection(selections, chooseByIds(request, ["postgresql"], "database"));
    } else {
      addSelection(selections, chooseByIds(request, ["supabase"], "database") ?? chooseTool(request, "database"));
    }
  }

  if (wantsAuth) {
    const authIds = preferredIds.includes("clerk")
      ? ["clerk"]
      : preferredIds.includes("authjs")
        ? ["authjs"]
        : ["supabase-auth"];
    addSelection(selections, chooseByIds(request, authIds, "authentication") ?? chooseTool(request, "authentication"));
  }

  if (wantsAi) {
    const aiIds = preferredIds.filter((id) => ["openai", "anthropic", "gemini"].includes(id));
    addSelection(selections, chooseByIds(request, aiIds.length ? aiIds : ["openai"], "ai-provider") ?? chooseTool(request, "ai-provider"));
  }

  if (!localOnly && request.deploymentPreference === "Deploy online") {
    const hostingIds = pythonPreferred ? ["render"] : offline ? ["cloudflare-pages"] : ["vercel"];
    addSelection(selections, chooseByIds(request, hostingIds, "hosting") ?? chooseTool(request, "hosting"));
  }

  addSelection(selections, chooseByIds(request, ["git"], "developer-tool") ?? chooseTool(request, "developer-tool"));
  addSelection(selections, chooseByIds(request, ["github"], "version-control") ?? chooseTool(request, "version-control"));

  if (request.category !== "Portfolio website" || wantsAi || wantsAuth) {
    addSelection(selections, chooseByIds(request, ["vitest"], "testing") ?? chooseTool(request, "testing"));
  }
  if (wantsAnalytics) addSelection(selections, chooseTool(request, "analytics"));
  if (wantsPayments) addSelection(selections, chooseByIds(request, ["stripe"], "developer-tool"));
  if (containsAny(text, ["container", "docker", "reproducible environment"]) && request.experienceLevel !== "Beginner") {
    addSelection(selections, chooseByIds(request, ["docker"], "developer-tool"));
  }

  return [...selections.values()].filter(Boolean).slice(0, MAX_STACK_ITEMS) as NonNullable<ReturnType<typeof chooseTool>>[];
}

function stackItem(candidate: NonNullable<ReturnType<typeof chooseTool>>): PlanStackItem {
  return {
    toolId: candidate.tool.id,
    toolName: candidate.tool.name,
    category: candidate.tool.category,
    reason: candidate.reasons[0],
    tradeoffs: candidate.tradeoffs,
    confidence: candidate.score >= 45 ? "high" : candidate.score >= 25 ? "medium" : "low",
  };
}

export interface ModelPlanSignals {
  summary?: string;
  selectedToolIds: string[];
  alternativeToolIds: string[];
  openQuestions: string[];
  assumptions: string[];
}

function stackItemForTool(request: ProjectRequest, tool: CatalogueTool): PlanStackItem {
  const scored = scoreTool(tool, request);
  return stackItem({ tool, ...scored });
}

/**
 * Apply a validated model selection to the deterministic plan skeleton. The
 * model can choose only catalogue IDs; roadmap, budget, compatibility, and
 * source metadata remain server-owned and deterministic.
 */
export function applyModelPlanSignals(
  request: ProjectRequest,
  basePlan: SolutionPlan,
  signals: ModelPlanSignals,
  provenance: SolutionPlan["provenance"] = "model-assisted",
): SolutionPlan {
  const selectedTools = signals.selectedToolIds
    .map((id) => getCatalogueTool(id))
    .filter((tool): tool is CatalogueTool => Boolean(tool));
  if (!selectedTools.length) return basePlan;

  const selectedIds = selectedTools.map((tool) => tool.id);
  const alternatives = signals.alternativeToolIds
    .map((id) => getCatalogueTool(id))
    .filter((tool): tool is CatalogueTool => Boolean(tool))
    .filter((tool) => !selectedIds.includes(tool.id))
    .slice(0, 4)
    .map((tool) => ({
      toolId: tool.id,
      toolName: tool.name,
      tradeoff: "Model-suggested alternative; verify current documentation, limits, and project fit before committing.",
    }));
  const cleanLines = (values: string[], maximum: number, length: number) => [...new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().slice(0, length))
      .filter(Boolean),
  )].slice(0, maximum);
  const modelQuestions = cleanLines(signals.openQuestions, 4, 240);
  const modelAssumptions = cleanLines(signals.assumptions, 6, 300);

  return {
    ...basePlan,
    generatedAt: new Date().toISOString(),
    provenance,
    summary: typeof signals.summary === "string" && signals.summary.trim()
      ? signals.summary.trim().slice(0, 700)
      : `A model-assisted direction selected ${selectedTools.map((tool) => tool.name).join(", ")} from the curated catalogue. Verify the current documentation and constraints before committing.`,
    stack: selectedTools.slice(0, MAX_STACK_ITEMS).map((tool) => stackItemForTool(request, tool)),
    compatibility: validateCatalogueCompatibility(selectedIds),
    alternatives: alternatives.length ? alternatives : basePlan.alternatives,
    openQuestions: modelQuestions.length ? modelQuestions : basePlan.openQuestions,
    assumptions: [
      ...modelAssumptions,
      "The model selected catalogue entries, but current pricing, compatibility, and service limits remain unverified.",
    ].slice(0, 8),
    sources: selectedTools.map((tool) => ({
      kind: "catalogue" as const,
      label: `${tool.name} official pages (curated link)`,
      url: tool.documentationUrl,
      verificationStatus: "curated" as const,
    })),
  };
}

function alternativesFor(request: ProjectRequest, selectedIds: string[]) {
  const alternatives: PlanAlternative[] = [];
  const add = (toolId: string, tradeoff: string) => {
    const tool = getCatalogueTool(toolId);
    if (tool && !selectedIds.includes(toolId)) alternatives.push({ toolId, toolName: tool.name, tradeoff });
  };

  if (selectedIds.includes("nextjs")) add("vite", "Lighter frontend setup, but backend and routing decisions become more explicit.");
  if (selectedIds.includes("vite")) add("nextjs", "More integrated full-stack conventions, with a larger framework surface.");
  if (selectedIds.includes("supabase")) add("postgresql", "More control over database hosting, with more operations to own.");
  if (selectedIds.includes("sqlite")) add("supabase", "Hosted relational services can support multi-device collaboration, but add network dependency.");
  if (selectedIds.includes("vercel")) add("render", "More general service hosting, but typically more deployment configuration for frontend projects.");
  if (selectedIds.includes("render")) add("vercel", "Convenient frontend deployment, but less general for Python services.");
  if (selectedIds.includes("openai")) add("anthropic", "A second hosted model provider to compare for quality, limits, and cost.");
  if (selectedIds.includes("fastapi")) add("node", "Keeps frontend and backend in one language, but changes the Python ecosystem fit.");
  return alternatives.slice(0, 4);
}

function openQuestionsFor(request: ProjectRequest, selectedIds: string[]) {
  const questions: string[] = [];
  if (request.budgetInr === null) questions.push("What is the maximum monthly spend after a prototype is working?");
  if (selectedIds.some((id) => ["openai", "anthropic", "gemini"].includes(id))) {
    questions.push("Should the AI feature work without a paid external API, or is a provider budget acceptable?");
  }
  if (selectedIds.includes("supabase-auth") || selectedIds.includes("clerk") || selectedIds.includes("authjs")) {
    questions.push("Which sign-in methods and account data must be supported?");
  }
  if (containsAny(requestText(request), ["offline", "local-first"])) {
    questions.push("When the device reconnects, what data needs to sync and how should conflicts be resolved?");
  }
  if (request.deploymentPreference === "Deploy online") {
    questions.push("What traffic, region, uptime, or data-residency expectations matter for the first release?");
  }
  return questions.slice(0, 4);
}

export function generateSolutionPlan(request: ProjectRequest, version = 1): SolutionPlan {
  const candidates = chooseStack(request);
  const stack = candidates.map(stackItem);
  const selectedIds = stack.map((item) => item.toolId);
  const compatibility = validateCatalogueCompatibility(selectedIds);
  const alternatives = alternativesFor(request, selectedIds);
  const openQuestions = openQuestionsFor(request, selectedIds);
  const offline = containsAny(requestText(request), ["offline", "local-first", "without internet"]);
  const online = request.deploymentPreference === "Deploy online";
  const budgetNotes = request.budgetInr === null
    ? ["No budget was supplied; current provider and hosting prices are not calculated."]
    : [
        `₹${new Intl.NumberFormat("en-IN").format(request.budgetInr)} is treated as a planning constraint, not a price estimate.`,
        "Catalogue pricing and free-tier limits are not live-verified in this prototype.",
      ];

  const roadmap: SolutionPlan["roadmap"] = [
    {
      order: 1,
      title: "Lock the first user journey",
      detail: "Write the smallest successful path and define what is explicitly out of scope.",
      outcome: "A testable first milestone instead of a broad feature list.",
    },
    {
      order: 2,
      title: "Set up the project foundation",
      detail: `Create the ${request.experienceLevel.toLowerCase()}-appropriate development environment, repository, and selected application shell.`,
      outcome: "A repeatable local development workflow.",
    },
    {
      order: 3,
      title: "Build the happy path",
      detail: `Implement the core ${request.category.toLowerCase()} flow using the selected stack before adding secondary features.`,
      outcome: "A thin but usable end-to-end slice.",
    },
    {
      order: 4,
      title: "Add data, identity, and edge cases",
      detail: "Only add persistence, auth, AI calls, or offline synchronization after the main flow is observable.",
      outcome: "A more reliable product with explicit boundaries.",
    },
    {
      order: 5,
      title: "Test and review the decisions",
      detail: "Cover the important user journey, invalid inputs, failure states, and any provider limits.",
      outcome: "Evidence for what works and a list of remaining risks.",
    },
  ];
  if (online && !offline) {
    roadmap.push({
      order: 6,
      title: "Deploy with guardrails",
      detail: "Configure environment secrets server-side, verify logs and limits, and deploy only after the local flow is stable.",
      outcome: "A controlled first release rather than an unverified launch.",
    });
  }

  const firstToolNames = stack.slice(0, 3).map((item) => item.toolName).join(", ");
  return {
    version,
    generatedAt: new Date().toISOString(),
    provenance: "deterministic-catalogue",
    summary: `A rule-based baseline for this ${request.category.toLowerCase()} brief starts with ${firstToolNames || "a small, inspectable foundation"}. It is a decision aid, not a live AI recommendation or verified price quote.`,
    stack,
    compatibility,
    alternatives,
    budget: {
      currency: "INR",
      budgetInr: request.budgetInr,
      costDrivers: [
        "Hosted database, authentication, hosting, analytics, and AI usage can become recurring cost drivers.",
        "Operational time, observability, backups, and provider limits are not priced by this prototype.",
      ],
      notes: budgetNotes,
    },
    roadmap,
    assumptions: [
      "The project will start as a focused prototype and requirements may change after user feedback.",
      "Official links are recorded for follow-up; catalogue entries have not been live-verified in this environment.",
      ...(offline ? ["Offline or local-first behavior is treated as a material constraint and needs a sync decision."] : []),
    ],
    openQuestions,
    sources: stack
      .map((item) => getCatalogueTool(item.toolId))
      .filter((tool): tool is CatalogueTool => Boolean(tool))
      .map((tool) => ({
        kind: "catalogue" as const,
        label: `${tool.name} official pages (curated link)`,
        url: tool.documentationUrl,
        verificationStatus: "curated" as const,
      })),
  };
}

export function recommendForProject(request: ProjectRequest) {
  return {
    relevantCatalogue: getRelevantCatalogueEntries(request),
    plan: generateSolutionPlan(request),
  };
}
