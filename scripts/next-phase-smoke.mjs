const baseUrl = process.env.MEDHARYA_BASE_URL ?? "http://localhost:3000";
const email = `smoke-${Date.now()}@example.com`;
const password = "smoke-password-123";
let cookie = "";
const cookieJar = new Map();

function rememberCookie(response) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") ?? "").split(/,(?=[^;,]+=)/);
  for (const setCookie of setCookies) {
    const pair = setCookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (!value || /(?:^|;)\s*max-age=0\b/i.test(setCookie)) cookieJar.delete(name);
    else cookieJar.set(name, value);
  }
  cookie = [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
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
    // Status-only responses are still useful for negative checks.
  }
  return { response, payload };
}

const home = await fetch(`${baseUrl}/`);
if (home.status !== 200) throw new Error("Landing page is not reachable.");

const anonymous = await request("/api/auth/anonymous-draft", {
  method: "POST",
  body: JSON.stringify({
    idea: "Build a budget-friendly student travel planner",
    category: "AI application",
    budgetInr: 5000,
    experienceLevel: "Beginner",
    preferredTechnologies: ["Python"],
    deploymentPreference: "Deploy online",
    additionalRequirements: "Keep the first version simple and accessible.",
    submittedAt: new Date().toISOString(),
    anonymousDraftId: "client-selected-id-that-must-be-ignored",
  }),
});
if (anonymous.response.status !== 200 || typeof anonymous.payload?.draft?.id !== "string" || anonymous.payload.project !== null) {
  throw new Error("Anonymous idea capture check failed.");
}

const draftId = anonymous.payload.draft.id;
const anonymousRetry = await request("/api/auth/anonymous-draft", {
  method: "POST",
  body: JSON.stringify({
    idea: "Build a budget-friendly student travel planner",
    category: "AI application",
    budgetInr: 5000,
    experienceLevel: "Beginner",
    preferredTechnologies: ["Python"],
    deploymentPreference: "Deploy online",
    additionalRequirements: "Keep the first version simple and accessible.",
    submittedAt: new Date().toISOString(),
  }),
});
if (anonymousRetry.response.status !== 200 || anonymousRetry.payload?.draft?.id !== draftId) {
  throw new Error("Anonymous draft retry idempotency check failed.");
}

const untrustedDraftId = await fetch(`${baseUrl}/api/auth/anonymous-draft`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    idea: "Build a budget-friendly student travel planner",
    category: "AI application",
    budgetInr: 5000,
    experienceLevel: "Beginner",
    preferredTechnologies: ["Python"],
    deploymentPreference: "Deploy online",
    additionalRequirements: "Keep the first version simple and accessible.",
    submittedAt: new Date().toISOString(),
    anonymousDraftId: draftId,
  }),
});
const untrustedDraftPayload = await untrustedDraftId.json();
if (untrustedDraftId.status !== 200 || untrustedDraftPayload.draft?.id === draftId) {
  throw new Error("A client-supplied anonymous draft id was accepted without the handoff cookie.");
}

const signup = await request("/api/auth/signup", {
  method: "POST",
  body: JSON.stringify({ email, password, displayName: "Smoke User" }),
});
if (signup.response.status !== 201 || !signup.payload.project?.id) {
  throw new Error("Signup and draft attachment check failed.");
}

const projectId = signup.payload.project.id;
const me = await request("/api/auth/me");
if (me.response.status !== 200 || me.payload.user?.email !== email) {
  throw new Error("Authenticated session check failed.");
}

const ownedProject = await request(`/api/projects/${projectId}`);
if (ownedProject.response.status !== 200 || ownedProject.payload.project?.id !== projectId) {
  throw new Error("Owned project read check failed.");
}

const patch = await request(`/api/projects/${projectId}`, {
  method: "PATCH",
  body: JSON.stringify({ additionalRequirements: "The first release must explain its assumptions." }),
});
if (patch.response.status !== 200 || !patch.payload.project?.request?.additionalRequirements) {
  throw new Error("Owned project update check failed.");
}

const oversizedPatch = await request(`/api/projects/${projectId}`, {
  method: "PATCH",
  body: JSON.stringify({ additionalRequirements: "x".repeat(20_000) }),
});
if (oversizedPatch.response.status !== 413) {
  throw new Error("Project PATCH body limit check failed.");
}

const operatingSystem = ownedProject.payload.project.operatingSystem;
const operatingSystemPatch = await request(`/api/projects/${projectId}/operating-system`, {
  method: "PATCH",
  body: JSON.stringify({ operatingSystem }),
});
if (operatingSystemPatch.response.status !== 200 || !Array.isArray(operatingSystemPatch.payload.project?.operatingSystem?.branches)) {
  throw new Error("Operating-system persistence check failed.");
}

const invalidOperatingSystem = structuredClone(operatingSystem);
invalidOperatingSystem.branches[0].workspaceId = "another-project";
const invalidOperatingSystemPatch = await request(`/api/projects/${projectId}/operating-system`, {
  method: "PATCH",
  body: JSON.stringify({ operatingSystem: invalidOperatingSystem }),
});
if (invalidOperatingSystemPatch.response.status !== 400) {
  throw new Error("Operating-system project-boundary validation check failed.");
}

const greetingChat = await request(`/api/chat`, {
  method: "POST",
  body: JSON.stringify({ projectId, message: "hi", messageId: `greeting-${Date.now()}` }),
});
if (
  greetingChat.response.status !== 200
  || typeof greetingChat.payload?.content !== "string"
  || (greetingChat.payload?.source === "deterministic-fallback" && greetingChat.payload?.content !== "Hi! How can I help with your project today?")
  || greetingChat.payload?.notice?.includes("Automatic research")
) {
  throw new Error("Server-owned natural greeting regression check failed.");
}

const researchAwareChat = await request(`/api/chat`, {
  method: "POST",
  body: JSON.stringify({
    projectId,
    message: "What is the current pricing and availability for this project stack?",
    messageId: `research-aware-${Date.now()}`,
  }),
});
if (
  researchAwareChat.response.status !== 200
  || typeof researchAwareChat.payload?.content !== "string"
  || typeof researchAwareChat.payload?.notice !== "string"
  || !researchAwareChat.payload.notice.includes("Automatic")
  || !researchAwareChat.payload.notice.includes("research")
  || !researchAwareChat.payload.workspace?.messages?.some((message) => message.source === "deterministic-fallback")
) {
  throw new Error("Research-aware server chat fallback check failed.");
}

const logout = await request("/api/auth/logout", { method: "POST" });
if (logout.response.status !== 200) throw new Error("Logout check failed.");

const privateAfterLogout = await request(`/api/projects/${projectId}`);
if (privateAfterLogout.response.status !== 401) throw new Error("Unauthenticated project protection check failed.");

const unauthenticatedAttachment = await fetch(`${baseUrl}/api/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: `smoke-untrusted-${Date.now()}@example.com`,
    password,
    anonymousDraftId: draftId,
  }),
});
const unauthenticatedAttachmentPayload = await unauthenticatedAttachment.json();
if (unauthenticatedAttachment.status !== 201 || unauthenticatedAttachmentPayload.project !== null) {
  throw new Error("A client-supplied anonymous draft id was used for unauthenticated attachment.");
}

const loginDraft = await request("/api/auth/anonymous-draft", {
  method: "POST",
  body: JSON.stringify({
    idea: "Build a second student travel planner",
    category: "AI application",
    budgetInr: 5000,
    experienceLevel: "Beginner",
    preferredTechnologies: ["Python"],
    deploymentPreference: "Deploy online",
    additionalRequirements: "Use the secure login handoff.",
    submittedAt: new Date().toISOString(),
  }),
});
if (loginDraft.response.status !== 200 || !loginDraft.payload.draft?.id) {
  throw new Error("Login handoff draft setup failed.");
}
const loginHandoff = await request("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email, password }),
});
if (loginHandoff.response.status !== 200 || !loginHandoff.payload.project?.id) {
  throw new Error("Login handoff attachment check failed.");
}
await request("/api/auth/logout", { method: "POST" });

const secondEmail = `smoke-other-${Date.now()}@example.com`;
const secondSignup = await request("/api/auth/signup", {
  method: "POST",
  body: JSON.stringify({ email: secondEmail, password }),
});
if (secondSignup.response.status !== 201) throw new Error("Second account setup check failed.");
const crossUserRead = await request(`/api/projects/${projectId}`);
if (crossUserRead.response.status !== 404) throw new Error("Cross-user project isolation check failed.");

console.log(`Next-phase smoke checks passed against ${baseUrl}.`);
