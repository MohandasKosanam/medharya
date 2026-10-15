const baseUrl = process.env.MEDHARYA_BASE_URL ?? "http://localhost:3000";

async function jsonRequest(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // The status is still useful when an endpoint returns no JSON body.
  }
  return { response, payload };
}

const home = await fetch(`${baseUrl}/`);
const homeHtml = await home.text();
if (home.status !== 200 || !homeHtml.includes("shape your idea")) {
  throw new Error("Landing page smoke check failed.");
}

const workspaceRoute = await fetch(`${baseUrl}/workspace/smoke_project`);
if (workspaceRoute.status !== 200) {
  throw new Error("Workspace route smoke check failed.");
}

const workspace = {
  id: "smoke_project",
  name: "Smoke project",
  request: {
    idea: "Build a simple portfolio website",
    category: "Portfolio website",
    budgetInr: 0,
    experienceLevel: "Beginner",
    preferredTechnologies: [],
    deploymentPreference: "Local development only",
    additionalRequirements: "",
  },
  memory: {
    confirmedRequirements: ["Build a simple portfolio website"],
    userPreferences: [],
    technologyDecisions: [],
    rejectedAlternatives: [],
    openQuestions: [],
    recentSummary: "",
    currentPlanVersion: 1,
  },
  plan: {
    summary: "A deterministic baseline",
    provenance: "deterministic-catalogue",
    stack: [{ toolName: "Vite", category: "frontend" }],
    roadmap: [{ order: 1, title: "Define scope", detail: "Define scope" }],
  },
  messages: [],
};

const requestBase = {
  submittedAt: "2026-01-01T00:00:00.000Z",
  additionalRequirements: "",
};
const portfolioRequest = {
  ...requestBase,
  idea: "Build a simple portfolio website",
  category: "Portfolio website",
  budgetInr: 0,
  experienceLevel: "Beginner",
  preferredTechnologies: [],
  deploymentPreference: "Local development only",
};
const aiRequest = {
  ...requestBase,
  idea: "Build an AI travel companion for students",
  category: "AI application",
  budgetInr: 5000,
  experienceLevel: "Intermediate",
  preferredTechnologies: ["Python"],
  deploymentPreference: "Deploy online",
};

const invalidChat = await jsonRequest("/api/chat", { workspace, message: "" });
if (invalidChat.response.status !== 400) {
  throw new Error("Chat validation smoke check failed.");
}

const validChat = await jsonRequest("/api/chat", { workspace, message: "What should I build first?" });
if (validChat.response.status !== 200 || typeof validChat.payload?.content !== "string" || !["deterministic-fallback", "model-assisted"].includes(validChat.payload?.source)) {
  throw new Error("Context-aware chat smoke check failed.");
}

const [portfolioPlan, aiPlan] = await Promise.all([
  jsonRequest("/api/plan", portfolioRequest),
  jsonRequest("/api/plan", aiRequest),
]);
const portfolioStack = portfolioPlan.payload?.plan?.stack?.map((item) => item.toolId).join(",");
const aiStack = aiPlan.payload?.plan?.stack?.map((item) => item.toolId).join(",");
if (portfolioPlan.response.status !== 200 || aiPlan.response.status !== 200 || !portfolioStack || !aiStack || portfolioStack === aiStack) {
  throw new Error("Recommendation differentiation smoke check failed.");
}

const research = await jsonRequest("/api/research", { query: "Next.js official documentation" });
if (![200, 503].includes(research.response.status)) {
  throw new Error("Research availability smoke check failed.");
}

console.log(`Phase 2 smoke checks passed against ${baseUrl}.`);
