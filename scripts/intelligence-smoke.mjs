const baseUrl = process.env.MEDHARYA_BASE_URL ?? "http://localhost:3000";
const firstEmail = `intelligence-${Date.now()}@example.com`;
const secondEmail = `intelligence-other-${Date.now()}@example.com`;
const password = "smoke-password-123";
let cookie = "";

function rememberCookie(response) {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  rememberCookie(response);
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // A status-only response is enough for a negative check.
  }
  return { response, payload };
}

const home = await fetch(`${baseUrl}/`);
if (home.status !== 200) throw new Error("Landing page is not reachable.");

const anonymous = await request("/api/auth/anonymous-draft", {
  method: "POST",
  body: JSON.stringify({
    idea: "Build an evidence-aware project research workspace",
    category: "AI application",
    budgetInr: 5000,
    experienceLevel: "Intermediate",
    preferredTechnologies: ["TypeScript"],
    deploymentPreference: "Local development only",
    additionalRequirements: "Keep external providers optional and clearly labelled.",
    submittedAt: new Date().toISOString(),
  }),
});
if (anonymous.response.status !== 200 || typeof anonymous.payload?.draft?.id !== "string") {
  throw new Error("Anonymous project capture failed.");
}

const signup = await request("/api/auth/signup", {
  method: "POST",
  body: JSON.stringify({ email: firstEmail, password, displayName: "Intelligence Smoke", anonymousDraftId: anonymous.payload.draft.id }),
});
if (signup.response.status !== 201 || typeof signup.payload?.project?.id !== "string") {
  throw new Error("Smoke account/project creation failed.");
}
const projectId = signup.payload.project.id;

const aiStatus = await request(`/api/ai/status?projectId=${encodeURIComponent(projectId)}`);
if (aiStatus.response.status !== 200 || aiStatus.payload?.providerStatus?.state !== "unavailable") {
  throw new Error("Unavailable-provider status check failed.");
}

const chat = await request("/api/chat", {
  method: "POST",
  body: JSON.stringify({ projectId, message: "What should be checked before committing to this direction?", messageId: "intelligence-smoke-message" }),
});
if (chat.response.status !== 200 || chat.payload?.contextSource !== "server-owned" || typeof chat.payload?.workspace?.id !== "string") {
  throw new Error("Server-owned project chat check failed.");
}
if (!chat.payload.workspace.messages.some((message) => message.id === "intelligence-smoke-message")) {
  throw new Error("Server-owned chat message was not persisted.");
}

const idempotentChat = await request("/api/chat", {
  method: "POST",
  body: JSON.stringify({ projectId, message: "What should be checked before committing to this direction?", messageId: "intelligence-smoke-message" }),
});
if (idempotentChat.response.status !== 200 || idempotentChat.payload?.workspace?.messages.filter((message) => message.id === "intelligence-smoke-message").length !== 1) {
  throw new Error("Server-owned chat idempotency check failed.");
}

const research = await request("/api/research", {
  method: "POST",
  body: JSON.stringify({ projectId, query: "Next.js official documentation" }),
});
if (![200, 502, 503].includes(research.response.status)) {
  throw new Error("Server-owned research availability check failed.");
}
if (research.response.status === 200 && research.payload?.contextSource !== "server-owned") {
  throw new Error("Available research did not report server-owned context.");
}

await request("/api/auth/logout", { method: "POST" });
const unauthenticatedChat = await request("/api/chat", {
  method: "POST",
  body: JSON.stringify({ projectId, message: "This must not cross the session boundary." }),
});
if (unauthenticatedChat.response.status !== 401) throw new Error("Unauthenticated project chat was not blocked.");

const secondSignup = await request("/api/auth/signup", {
  method: "POST",
  body: JSON.stringify({ email: secondEmail, password }),
});
if (secondSignup.response.status !== 201) throw new Error("Second smoke account creation failed.");
const crossUserChat = await request("/api/chat", {
  method: "POST",
  body: JSON.stringify({ projectId, message: "This must not read another project." }),
});
if (crossUserChat.response.status !== 404) throw new Error("Cross-user project chat was not isolated.");

console.log(`Intelligence smoke checks passed against ${baseUrl}.`);
