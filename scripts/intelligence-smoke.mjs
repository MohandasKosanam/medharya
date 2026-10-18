const baseUrl = process.env.MEDHARYA_BASE_URL ?? "http://localhost:3000";
const firstEmail = `intelligence-${Date.now()}@example.com`;
const secondEmail = `intelligence-other-${Date.now()}@example.com`;
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

const operatingSystem = structuredClone(signup.payload.project.operatingSystem);
const parentBranch = operatingSystem?.branches?.find((branch) => branch.template === "product-strategy") ?? operatingSystem?.branches?.[0];
if (!parentBranch || !Array.isArray(operatingSystem?.branches) || !Array.isArray(operatingSystem?.edges)) {
  throw new Error("Server-owned operating-system records were not initialized.");
}
operatingSystem.viewport = { zoom: 1.15, pan: { x: 42, y: -18 } };
const nestedBranch = {
  id: `${projectId}-nested-smoke`,
  workspaceId: projectId,
  name: "Nested smoke branch",
  template: "development-architecture",
  description: "A nested branch used by the backend smoke check.",
  status: "active",
  provenance: "user",
  approvalStatus: "pending",
  parentBranchId: parentBranch.id,
  canvasPosition: { x: 318, y: 214 },
  messages: [],
  requirements: ["Keep the nested context explicit."],
  researchFindingIds: [],
  decisionIds: [],
  taskIds: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
operatingSystem.branches.push(nestedBranch);
operatingSystem.edges.push({
  id: `${projectId}-nested-related-smoke`,
  fromBranchId: nestedBranch.id,
  toBranchId: parentBranch.id,
  relationship: "related-to",
  status: "active",
  provenance: "user",
  approvalStatus: "pending",
  rationale: "Smoke relationship",
});
const operatingSystemPatch = await request(`/api/projects/${projectId}/operating-system`, {
  method: "PATCH",
  body: JSON.stringify({ operatingSystem }),
});
if (operatingSystemPatch.response.status !== 200 || operatingSystemPatch.payload.project?.operatingSystem?.viewport?.zoom !== 1.15 || operatingSystemPatch.payload.project?.operatingSystem?.viewport?.pan?.x !== 42 || !operatingSystemPatch.payload.project?.operatingSystem?.branches?.some((branch) => branch.id === nestedBranch.id && branch.parentBranchId === parentBranch.id && branch.canvasPosition?.x === 318 && branch.canvasPosition?.y === 214)) {
  throw new Error("Nested branch persistence check failed.");
}

const persistedOperatingSystem = operatingSystemPatch.payload.project.operatingSystem;
const invalidViewport = structuredClone(persistedOperatingSystem);
invalidViewport.viewport = { zoom: 99, pan: { x: 0, y: 0 } };
const invalidViewportUpdate = await request(`/api/projects/${projectId}/operating-system`, {
  method: "PATCH",
  body: JSON.stringify({ operatingSystem: invalidViewport }),
});
if (invalidViewportUpdate.response.status !== 400) {
  throw new Error("Invalid canvas viewport validation check failed.");
}

const invalidPosition = structuredClone(persistedOperatingSystem);
invalidPosition.branches.find((branch) => branch.id === nestedBranch.id).canvasPosition = { x: 1_000_001, y: 0 };
const invalidPositionUpdate = await request(`/api/projects/${projectId}/operating-system`, {
  method: "PATCH",
  body: JSON.stringify({ operatingSystem: invalidPosition }),
});
if (invalidPositionUpdate.response.status !== 400) {
  throw new Error("Invalid canvas position validation check failed.");
}

const danglingEdge = structuredClone(persistedOperatingSystem);
danglingEdge.edges.push({
  id: `${projectId}-dangling-edge-smoke`,
  fromBranchId: nestedBranch.id,
  toBranchId: `${projectId}-missing-branch`,
  relationship: "related-to",
  status: "active",
  provenance: "user",
  approvalStatus: "pending",
  rationale: "Must be rejected",
});
const danglingEdgeUpdate = await request(`/api/projects/${projectId}/operating-system`, {
  method: "PATCH",
  body: JSON.stringify({ operatingSystem: danglingEdge }),
});
if (danglingEdgeUpdate.response.status !== 400) {
  throw new Error("Dangling branch edge validation check failed.");
}

const cyclicBranches = structuredClone(persistedOperatingSystem);
cyclicBranches.branches.find((branch) => branch.id === parentBranch.id).parentBranchId = nestedBranch.id;
const cyclicBranchUpdate = await request(`/api/projects/${projectId}/operating-system`, {
  method: "PATCH",
  body: JSON.stringify({ operatingSystem: cyclicBranches }),
});
if (cyclicBranchUpdate.response.status !== 400) {
  throw new Error("Nested branch cycle validation check failed.");
}

const legacyViewport = structuredClone(persistedOperatingSystem);
delete legacyViewport.viewport;
legacyViewport.canvasViewport = { zoom: 1.2, pan: { x: -12, y: 8 } };
const legacyViewportUpdate = await request(`/api/projects/${projectId}/operating-system`, {
  method: "PATCH",
  body: JSON.stringify({ operatingSystem: legacyViewport }),
});
if (legacyViewportUpdate.response.status !== 200 || legacyViewportUpdate.payload.project?.operatingSystem?.viewport?.zoom !== 1.2 || legacyViewportUpdate.payload.project?.operatingSystem?.canvasViewport !== undefined) {
  throw new Error("Legacy canvas viewport migration check failed.");
}

const crossProjectBranch = structuredClone(operatingSystemPatch.payload.project.operatingSystem);
crossProjectBranch.branches.find((branch) => branch.id === nestedBranch.id).workspaceId = "another-project";
const crossProjectUpdate = await request(`/api/projects/${projectId}/operating-system`, {
  method: "PATCH",
  body: JSON.stringify({ operatingSystem: crossProjectBranch }),
});
if (crossProjectUpdate.response.status !== 400) {
  throw new Error("Cross-project nested branch validation check failed.");
}

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

const concurrentMessageId = "intelligence-smoke-concurrent-message";
const [concurrentChatA, concurrentChatB] = await Promise.all([
  request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ projectId, message: "Check this concurrent retry.", messageId: concurrentMessageId }),
  }),
  request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ projectId, message: "Check this concurrent retry.", messageId: concurrentMessageId }),
  }),
]);
if (concurrentChatA.response.status !== 200 || concurrentChatB.response.status !== 200) {
  throw new Error("Concurrent chat retry requests were not accepted.");
}
const afterConcurrentChat = await request(`/api/projects/${projectId}`);
if (
  afterConcurrentChat.response.status !== 200 ||
  afterConcurrentChat.payload.project?.messages?.filter((message) => message.id === concurrentMessageId).length !== 1
) {
  throw new Error("Concurrent chat retry idempotency check failed.");
}

const branchChat = await request("/api/chat", {
  method: "POST",
  body: JSON.stringify({ projectId, branchId: nestedBranch.id, message: "What is the current availability of the nested branch stack?", messageId: "intelligence-smoke-branch-message" }),
});
if (branchChat.response.status !== 200 || branchChat.payload?.contextSource !== "server-owned" || !branchChat.payload?.notice?.includes("Automatic research")) {
  throw new Error("Server-owned branch chat routing check failed.");
}
const persistedNestedBranch = branchChat.payload.workspace?.operatingSystem?.branches?.find((branch) => branch.id === nestedBranch.id);
if (!persistedNestedBranch?.messages?.some((message) => message.id === "intelligence-smoke-branch-message")) {
  throw new Error("Server-owned branch chat persistence check failed.");
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
  body: JSON.stringify({ projectId, branchId: nestedBranch.id, query: "Next.js official documentation" }),
});
if (![200, 502, 503].includes(research.response.status)) {
  throw new Error("Server-owned research availability check failed.");
}
if (research.response.status === 200 && research.payload?.contextSource !== "server-owned") {
  throw new Error("Available research did not report server-owned context.");
}
if (research.response.status === 200) {
  const branchAfterResearch = research.payload.workspace?.operatingSystem?.branches?.find((branch) => branch.id === nestedBranch.id);
  const findingIds = research.payload.findings?.map((finding) => finding.id) ?? [];
  if (!branchAfterResearch || findingIds.some((findingId) => !branchAfterResearch.researchFindingIds.includes(findingId))) {
    throw new Error("Branch research references were not persisted.");
  }
}

const deleteSourceOperatingSystem = structuredClone(
  research.payload.workspace?.operatingSystem ?? persistedOperatingSystem,
);
deleteSourceOperatingSystem.branches = deleteSourceOperatingSystem.branches.filter(
  (branch) => branch.id !== nestedBranch.id,
);
deleteSourceOperatingSystem.edges = deleteSourceOperatingSystem.edges.filter(
  (edge) => edge.fromBranchId !== nestedBranch.id && edge.toBranchId !== nestedBranch.id,
);
const deletedBranch = await request(`/api/projects/${projectId}/operating-system`, {
  method: "PATCH",
  body: JSON.stringify({
    operatingSystem: deleteSourceOperatingSystem,
    deletedBranchIds: [nestedBranch.id],
  }),
});
if (
  deletedBranch.response.status !== 200 ||
  deletedBranch.payload.project?.operatingSystem?.branches?.some((branch) => branch.id === nestedBranch.id)
) {
  throw new Error("Branch deletion persistence check failed.");
}
const reloadedAfterBranchDelete = await request(`/api/projects/${projectId}`);
if (
  reloadedAfterBranchDelete.response.status !== 200 ||
  reloadedAfterBranchDelete.payload.project?.operatingSystem?.branches?.some((branch) => branch.id === nestedBranch.id)
) {
  throw new Error("Deleted branch was resurrected by the server merge.");
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
