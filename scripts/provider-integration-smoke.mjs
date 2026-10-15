import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const providerServer = createServer();
let providerRequests = 0;

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

providerServer.on("request", async (request, response) => {
  if (request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  const rawBody = await readRequestBody(request);
  const body = JSON.parse(rawBody);
  if (body.model !== "mock-model" || !Array.isArray(body.messages)) {
    response.writeHead(400).end();
    return;
  }
  providerRequests += 1;
  if (providerRequests === 1) {
    response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "transient test response" }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
    choices: [{ message: { content: "Mock provider response grounded in the server-owned project context." } }],
    usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 },
  }));
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function waitForApp(baseUrl, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("The provider smoke Next.js server exited before it became ready.");
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.status === 200) return;
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the provider smoke Next.js server.");
}

const providerPort = await listen(providerServer);
const appPort = Number(process.env.MEDHARYA_PROVIDER_SMOKE_PORT ?? 3021);
const baseUrl = `http://127.0.0.1:${appPort}`;
const dataFile = join(tmpdir(), `medharya-provider-smoke-${Date.now()}.json`);
const childCommand = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
const childArgs = process.platform === "win32"
  ? ["/d", "/s", "/c", `npm start -- --port ${appPort}`]
  : ["start", "--", "--port", String(appPort)];
const child = spawn(childCommand, childArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    MEDHARYA_AI_API_KEY: "mock-key",
    MEDHARYA_AI_MODEL: "mock-model",
    MEDHARYA_AI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
    MEDHARYA_DISABLE_EXTERNAL_PROVIDERS: "0",
    BRAVE_SEARCH_API_KEY: "",
    MEDHARYA_SERVER_DATA_FILE: dataFile,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const output = [];
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
}

try {
  await waitForApp(baseUrl, child);
  const email = `provider-smoke-${Date.now()}@example.com`;
  const anonymous = await request("/api/auth/anonymous-draft", {
    method: "POST",
    body: JSON.stringify({
      idea: "Build a server-owned provider integration test",
      category: "AI application",
      budgetInr: 0,
      experienceLevel: "Intermediate",
      preferredTechnologies: [],
      deploymentPreference: "Local development only",
      additionalRequirements: "Keep the test deterministic.",
      submittedAt: new Date().toISOString(),
    }),
  });
  const anonymousPayload = await anonymous.json();
  const signup = await request("/api/auth/signup", {
    method: "POST",
    headers: { cookie: anonymous.headers.get("set-cookie")?.split(";")[0] ?? "" },
    body: JSON.stringify({ email, password: "provider-password-123", anonymousDraftId: anonymousPayload.draft.id }),
  });
  const signupPayload = await signup.json();
  const projectId = signupPayload.project?.id;
  const cookie = signup.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (signup.status !== 201 || typeof projectId !== "string" || !cookie) throw new Error("Provider smoke account setup failed.");

  const chat = await request("/api/chat", {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ projectId, message: "Return the provider-backed answer.", messageId: "provider-smoke-message" }),
  });
  const chatPayload = await chat.json();
  if (chat.status !== 200 || chatPayload.source !== "model-assisted" || chatPayload.provider !== "openai-compatible" || chatPayload.usage?.totalTokens !== 21) {
    throw new Error("Provider-backed chat response was not normalized as expected.");
  }
  if (providerRequests < 2) throw new Error("Transient provider failure did not exercise the bounded retry.");

  console.log(`Provider integration smoke checks passed against ${baseUrl}.`);
} catch (error) {
  const detail = output.join("").slice(-2_000);
  throw new Error(`${error instanceof Error ? error.message : "Provider smoke failed."}${detail ? `\n${detail}` : ""}`);
} finally {
  providerServer.close();
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    await new Promise((resolve) => killer.once("close", resolve));
  } else {
    child.kill("SIGTERM");
  }
  await rm(dataFile, { force: true });
}
