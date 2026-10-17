import type { ProjectWorkspace } from "@/types/workspace";

export interface AssistantReply {
  content: string;
  source: "deterministic-fallback" | "model-assisted";
  provider?: string;
  model?: string;
  notice?: string;
}

function includesAny(value: string, terms: string[]) {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function toolNames(workspace: ProjectWorkspace, category?: string) {
  return workspace.plan.stack
    .filter((item) => !category || item.category === category)
    .map((item) => item.toolName)
    .join(", ");
}

function deterministicGreeting(message: string) {
  const normalized = message.trim().toLowerCase().replace(/[!?.]+$/, "");
  return {
    hi: "Hi! How can I help with your project today?",
    hello: "Hello! How can I help with your project today?",
    hey: "Hey! How can I help with your project today?",
    "good morning": "Good morning! How can I help with your project today?",
  }[normalized];
}

function deterministicAnswer(workspace: ProjectWorkspace, message: string): AssistantReply {
  const lowerMessage = message.toLowerCase();
  const greeting = deterministicGreeting(message);
  const database = toolNames(workspace, "database") || "the selected database";
  const frontend = toolNames(workspace, "frontend") || "the selected frontend";
  const hosting = toolNames(workspace, "hosting") || "an online host still to be selected";

  if (greeting) {
    return {
      source: "deterministic-fallback",
      content: greeting,
    };
  }

  if (includesAny(lowerMessage, ["why", "reason"]) && includesAny(lowerMessage, ["database", "db", "storage"])) {
    return {
      source: "deterministic-fallback",
      content: `The current baseline uses ${database} because it matches the brief’s project type and constraints in the curated rules. The trade-off is that the catalogue does not verify your runtime workload or current service limits. If you need more control, the plan lists alternatives; tell me what matters most—offline use, relational queries, low operations, or scale—and I can compare them.`,
    };
  }

  if (includesAny(lowerMessage, ["cheaper", "cost", "budget", "free", "paid"])) {
    return {
      source: "deterministic-fallback",
      content: `The plan treats ${workspace.request.budgetInr === null ? "your budget as unspecified" : `₹${workspace.request.budgetInr} as a constraint`}, but it does not invent current prices. The low-cost direction favors open-source tools where possible. Hosted databases, authentication, hosting, analytics, and AI APIs may still create recurring costs, so use the official pricing links in the plan and verify limits before committing.`,
    };
  }

  if (includesAny(lowerMessage, ["offline", "local-first", "without internet"])) {
    return {
      source: "deterministic-fallback",
      content: `Offline-first is a material architecture change, not just a UI toggle. The current plan can favor local storage such as ${database}, but it still needs an explicit sync decision: what is stored offline, when it syncs, and how conflicts are resolved. I will not silently change the brief; use the brief editor to approve that constraint.`,
    };
  }

  if (includesAny(lowerMessage, ["first", "roadmap", "start", "next step", "implement"])) {
    const firstSteps = workspace.plan.roadmap.slice(0, 3).map((step) => `${step.order}. ${step.title} — ${step.detail}`).join("\n");
    return {
      source: "deterministic-fallback",
      content: `Start with the smallest user journey, then establish the foundation before expanding the stack. Based on the current brief:\n${firstSteps}\n\nThe selected frontend direction is ${frontend}. ${workspace.request.deploymentPreference === "Deploy online" ? `For deployment, the current direction is ${hosting}.` : "Deployment is not being treated as a launch requirement yet."}`,
    };
  }

  if (includesAny(lowerMessage, ["research", "source", "citation", "verify", "latest"])) {
    return {
      source: "deterministic-fallback",
      content: workspace.researchFindings.length
        ? `There are ${workspace.researchFindings.length} retrieved research result(s) attached to this project. They are marked as retrieved-not-yet-verified; use the source links and confirm the claim before treating them as a decision.`
        : "Live research is not configured in this workspace, so I will not fabricate search results or citations. The catalogue links are curated official destinations and are explicitly marked as not live-verified.",
    };
  }

  const question = workspace.memory.openQuestions[0];
  return {
    source: "deterministic-fallback",
    content: [
      `I’m keeping this response grounded in the current project brief rather than generating a new stack. The baseline plan uses ${frontend}${database ? ` with ${database}` : ""}.`,
      `\nThe recommendation provenance is ${workspace.plan.provenance}; it is rule-based catalogue output, not a live model or web-researched answer.`,
      question ? `\nThe next unresolved question is: ${question}` : "\nWhat constraint or decision would you like to challenge?",
    ].join(""),
  };
}

export function generateDeterministicAssistantReply(workspace: ProjectWorkspace, message: string) {
  return deterministicAnswer(workspace, message);
}
