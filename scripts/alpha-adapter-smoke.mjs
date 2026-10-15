import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const alphaServer = createServer();
const model = "medharya-alpha-v0.1";
const baseModel = "Qwen3-8B";
const adapterVersion = "Medharya Alpha v0.1";
const apiKey = "alpha-smoke-key";
let observedRequests = [];

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

alphaServer.on("request", async (request, response) => {
  if (request.headers.authorization !== `Bearer ${apiKey}` || !request.headers["x-request-id"]) {
    json(response, 401, { detail: "unauthorized" });
    return;
  }
  if (request.url === "/health" && request.method === "GET") {
    json(response, 200, { status: "ready", ready: true, model, base_model: baseModel, adapter_version: adapterVersion });
    return;
  }
  if (request.url !== "/chat" || request.method !== "POST") {
    json(response, 404, { detail: "not found" });
    return;
  }

  const body = JSON.parse(await readBody(request));
  observedRequests.push(body);
  if (!body.request_id || typeof body.message !== "string" || !Array.isArray(body.history)) {
    json(response, 422, { detail: "invalid request" });
    return;
  }
  if (body.message === "auth failure") {
    json(response, 401, { detail: "rejected by mock auth" });
    return;
  }
  if (body.message === "malformed response") {
    json(response, 200, { status: "ready" });
    return;
  }
  if (body.message === "timeout") {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  json(response, 200, {
    response: body.message === "large output" ? "x".repeat(30_000) : "Genuine-shaped mocked Alpha response.",
    model,
    base_model: baseModel,
    adapter_version: adapterVersion,
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  });
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function waitForApp(baseUrl, child) {
  return new Promise(async (resolve, reject) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        reject(new Error("The Alpha smoke Next.js server exited before becoming ready."));
        return;
      }
      try {
        const response = await fetch(`${baseUrl}/`);
        if (response.status === 200) {
          resolve();
          return;
        }
      } catch {
        // The production server is still starting.
      }
      await new Promise((next) => setTimeout(next, 250));
    }
    reject(new Error("Timed out waiting for the Alpha smoke Next.js server."));
  });
}

const alphaPort = await listen(alphaServer);
const appPort = Number(process.env.MEDHARYA_ALPHA_SMOKE_PORT ?? 3022);
const baseUrl = `http://127.0.0.1:${appPort}`;
const dataFile = join(tmpdir(), `medharya-alpha-smoke-${Date.now()}.json`);
const childCommand = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
const childArgs = process.platform === "win32"
  ? ["/d", "/s", "/c", `npm start -- --port ${appPort}`]
  : ["start", "--", "--port", String(appPort)];
const child = spawn(childCommand, childArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    MEDHARYA_AI_PROVIDER: "alpha",
    MEDHARYA_ALPHA_BASE_URL: `http://127.0.0.1:${alphaPort}`,
    MEDHARYA_ALPHA_API_KEY: apiKey,
    MEDHARYA_ALPHA_MODEL: model,
    MEDHARYA_ALPHA_BASE_MODEL: baseModel,
    MEDHARYA_ALPHA_ADAPTER_VERSION: adapterVersion,
    MEDHARYA_ALPHA_TIMEOUT_MS: "2000",
    MEDHARYA_ALPHA_ALLOW_INSECURE_LOCAL: "1",
    MEDHARYA_DISABLE_EXTERNAL_PROVIDERS: "0",
    BRAVE_SEARCH_API_KEY: "",
    MEDHARYA_SERVER_DATA_FILE: dataFile,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const output = [];
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

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
    // Status-only responses are enough for some negative checks.
  }
  return { response, payload };
}

try {
  await waitForApp(baseUrl, child);
  const email = `alpha-smoke-${Date.now()}@example.com`;
  const anonymous = await request("/api/auth/anonymous-draft", {
    method: "POST",
    body: JSON.stringify({
      idea: "Build a Medharya Alpha integration test workspace",
      category: "AI application",
      budgetInr: 0,
      experienceLevel: "Intermediate",
      preferredTechnologies: ["TypeScript"],
      deploymentPreference: "Local development only",
      additionalRequirements: "Keep the provider boundary server-side.",
      submittedAt: new Date().toISOString(),
    }),
  });
  const signup = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password: "alpha-smoke-password-123", anonymousDraftId: anonymous.payload.draft.id }),
  });
  const projectId = signup.payload.project?.id;
  if (signup.response.status !== 201 || typeof projectId !== "string" || !cookie) throw new Error("Alpha smoke account setup failed.");

  const health = await request(`/api/ai/status?projectId=${encodeURIComponent(projectId)}`);
  if (health.response.status !== 200 || health.payload.providerStatus?.provider !== "medharya-alpha" || health.payload.providerStatus?.state !== "ready" || health.payload.providerStatus?.identityVerified !== true) {
    throw new Error(`Alpha status route did not verify the mocked health response: HTTP ${health.response.status} ${JSON.stringify(health.payload)}`);
  }
  if (health.payload.providerStatus.baseModel !== baseModel || health.payload.providerStatus.adapterVersion !== adapterVersion) {
    throw new Error("Alpha status route did not expose the expected model identity metadata.");
  }

  const chat = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ projectId, message: "What should be checked first?", messageId: "alpha-smoke-message" }),
  });
  if (chat.response.status !== 200 || chat.payload.source !== "model-assisted" || chat.payload.provider !== "medharya-alpha" || chat.payload.providerStatus?.state !== "ready" || chat.payload.providerStatus?.identityVerified !== true) {
    throw new Error("Server-owned chat did not return the mocked Alpha response.");
  }
  if (!chat.payload.workspace.messages.some((message) => message.id === "alpha-smoke-message")) throw new Error("Alpha chat was not persisted.");

  const retry = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ projectId, message: "What should be checked first?", messageId: "alpha-smoke-message" }),
  });
  if (retry.response.status !== 200 || retry.payload.workspace.messages.filter((message) => message.id === "alpha-smoke-message").length !== 1) {
    throw new Error("Alpha chat idempotency failed.");
  }

  const largeOutput = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ projectId, message: "large output", messageId: "alpha-large-output" }),
  });
  if (largeOutput.response.status !== 200 || largeOutput.payload.source !== "model-assisted" || largeOutput.payload.content.length > 12_000) {
    throw new Error("Alpha output bound was not enforced through the chat route.");
  }

  const authFailure = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ projectId, message: "auth failure", messageId: "alpha-auth-failure" }),
  });
  if (authFailure.response.status !== 200 || authFailure.payload.source !== "deterministic-fallback" || authFailure.payload.providerStatus?.reason !== "auth") {
    throw new Error("Alpha authentication failure did not produce an explicit fallback state.");
  }

  const malformed = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ projectId, message: "malformed response", messageId: "alpha-malformed" }),
  });
  if (malformed.response.status !== 200 || malformed.payload.source !== "deterministic-fallback" || malformed.payload.providerStatus?.reason !== "invalid-response") {
    throw new Error("Malformed Alpha response did not produce an explicit fallback state.");
  }

  const timeout = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ projectId, message: "timeout", messageId: "alpha-timeout" }),
  });
  if (timeout.response.status !== 200 || timeout.payload.source !== "deterministic-fallback" || timeout.payload.providerStatus?.reason !== "timeout") {
    throw new Error("Alpha timeout did not produce an explicit fallback state.");
  }

  if (!observedRequests.length || observedRequests.some((body) => body.max_new_tokens !== 900 || body.history.length > 8)) {
    throw new Error("Alpha request bounds were not enforced.");
  }
  console.log("Alpha integration smoke checks passed against a local mocked FastAPI service; no live Alpha endpoint was contacted.");
} catch (error) {
  const detail = output.join("").slice(-2_000);
  throw new Error(`${error instanceof Error ? error.message : "Alpha smoke failed."}${detail ? `\n${detail}` : ""}`);
} finally {
  alphaServer.close();
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    await new Promise((resolve) => killer.once("close", resolve));
  } else {
    child.kill("SIGTERM");
  }
  await rm(dataFile, { force: true });
}
