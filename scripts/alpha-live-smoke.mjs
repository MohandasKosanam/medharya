const baseUrl = process.env.MEDHARYA_BASE_URL?.replace(/\/$/, "");
if (!baseUrl) {
  throw new Error("Set MEDHARYA_BASE_URL to the running Medharya backend before the live Alpha smoke test.");
}

const email = `alpha-live-${Date.now()}@example.com`;
const password = `alpha-live-${Date.now()}-password`;
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
    // The status is enough for the error below.
  }
  return { response, payload };
}

const anonymous = await request("/api/auth/anonymous-draft", {
  method: "POST",
  body: JSON.stringify({
    idea: "Verify a live Medharya Alpha project chat integration",
    category: "AI application",
    budgetInr: null,
    experienceLevel: "Intermediate",
    preferredTechnologies: ["TypeScript"],
    deploymentPreference: "Deploy online",
    additionalRequirements: "Use this only as a production connectivity smoke test.",
    submittedAt: new Date().toISOString(),
  }),
});
if (anonymous.response.status !== 200 || typeof anonymous.payload?.draft?.id !== "string") {
  throw new Error(`Live Alpha smoke could not create a temporary project draft (HTTP ${anonymous.response.status}).`);
}

const signup = await request("/api/auth/signup", {
  method: "POST",
  body: JSON.stringify({ email, password, displayName: "Alpha live smoke", anonymousDraftId: anonymous.payload.draft.id }),
});
if (signup.response.status !== 201 || typeof signup.payload?.project?.id !== "string") {
  throw new Error(`Live Alpha smoke could not create its temporary account/project (HTTP ${signup.response.status}).`);
}
const projectId = signup.payload.project.id;

const health = await request(`/api/ai/status?projectId=${encodeURIComponent(projectId)}`);
const providerStatus = health.payload?.providerStatus;
if (
  health.response.status !== 200 ||
  providerStatus?.provider !== "medharya-alpha" ||
  providerStatus?.state !== "ready" ||
  providerStatus?.identityVerified !== true ||
  typeof providerStatus?.baseModel !== "string" ||
  typeof providerStatus?.adapterVersion !== "string"
) {
  throw new Error("The live backend did not establish a ready, identity-attested Medharya Alpha service.");
}

const chat = await request("/api/chat", {
  method: "POST",
  body: JSON.stringify({
    projectId,
    message: "Reply with one concise sentence confirming this live integration test reached the configured Alpha service.",
    messageId: `alpha-live-${Date.now()}`,
  }),
});
if (
  chat.response.status !== 200 ||
  chat.payload?.source !== "model-assisted" ||
  chat.payload?.provider !== "medharya-alpha" ||
  chat.payload?.providerStatus?.state !== "ready" ||
  chat.payload?.providerStatus?.identityVerified !== true ||
  typeof chat.payload?.content !== "string" ||
  !chat.payload.content.trim()
) {
  throw new Error("The live backend did not return a genuine Alpha model-assisted response.");
}

console.log(JSON.stringify({
  live: true,
  backend: baseUrl,
  provider: chat.payload.provider,
  model: providerStatus.model ?? chat.payload.model ?? null,
  baseModel: providerStatus.baseModel,
  adapterVersion: providerStatus.adapterVersion,
  inferenceStatus: chat.payload.providerStatus.state,
  lastSuccessfulInferenceAt: chat.payload.providerStatus.lastSuccessfulInferenceAt ?? null,
}));
