import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ollamaServer = createServer();
const model = "qwen3:4b";
const appPort = Number(process.env.MEDHARYA_OLLAMA_SMOKE_PORT ?? 3023);
const baseUrl = `http://127.0.0.1:${appPort}`;
const dataFile = join(tmpdir(), `medharya-ollama-smoke-${Date.now()}.json`);
let mode = "success";
const observedRequests = [];

function json(response, status, payload) {
  if (response.destroyed) return;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

ollamaServer.on("request", async (request, response) => {
  if (request.url !== "/api/chat" || request.method !== "POST") {
    json(response, 404, { error: "not found" });
    return;
  }

  try {
    const body = JSON.parse(await readBody(request));
    observedRequests.push(body);

    if (mode === "timeout") {
      await delay(2_500);
      json(response, 200, {
        model,
        message: { role: "assistant", content: "Late response" },
        done: true,
      });
      return;
    }
    if (mode === "unavailable") {
      json(response, 503, { error: "mock Ollama unavailable" });
      return;
    }
    if (mode === "malformed") {
      json(response, 200, { model, message: { role: "assistant", thinking: "private only" }, done: true });
      return;
    }

    json(response, 200, {
      model,
      created_at: new Date().toISOString(),
      message: {
        role: "assistant",
        content: "<think>private reasoning [evidence:not-real]</think>Visible Ollama answer.",
        thinking: "private reasoning field",
      },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 12,
      eval_count: 9,
    });
  } catch {
    json(response, 400, { error: "invalid mock request" });
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function waitForApp(child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("The Ollama smoke Next.js server exited before it became ready.");
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.status === 200) return;
    } catch {
      // The production server is still starting.
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for the Ollama smoke Next.js server.");
}

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
    // The status is enough for some negative assertions.
  }
  return { response, payload };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const ollamaPort = await listen(ollamaServer);
const childCommand = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
const childArgs = process.platform === "win32"
  ? ["/d", "/s", "/c", `npm start -- --port ${appPort}`]
  : ["start", "--", "--port", String(appPort)];
const child = spawn(childCommand, childArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    MEDHARYA_AI_PROVIDER: "ollama",
    MEDHARYA_AI_API_KEY: "",
    MEDHARYA_AI_MODEL: "",
    MEDHARYA_AI_BASE_URL: "",
    MEDHARYA_OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaPort}`,
    MEDHARYA_OLLAMA_MODEL: model,
    MEDHARYA_OLLAMA_TIMEOUT_MS: "2000",
    MEDHARYA_DISABLE_EXTERNAL_PROVIDERS: "0",
    BRAVE_SEARCH_API_KEY: "",
    MEDHARYA_SERVER_DATA_FILE: dataFile,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const output = [];
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

try {
  await waitForApp(child);

  const email = `ollama-smoke-${Date.now()}@example.com`;
  const anonymous = await request("/api/auth/anonymous-draft", {
    method: "POST",
    body: JSON.stringify({
      idea: "Build an Ollama provider integration test workspace",
      category: "AI application",
      budgetInr: 0,
      experienceLevel: "Intermediate",
      preferredTechnologies: ["TypeScript"],
      deploymentPreference: "Local development only",
      additionalRequirements: "Keep Ollama server-side and loopback-only.",
      submittedAt: new Date().toISOString(),
    }),
  });
  assert(anonymous.response.status === 200 && typeof anonymous.payload.draft?.id === "string", "Ollama smoke draft setup failed.");

  const signup = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: "ollama-smoke-password-123",
      anonymousDraftId: anonymous.payload.draft.id,
    }),
  });
  const projectId = signup.payload.project?.id;
  assert(signup.response.status === 201 && typeof projectId === "string" && cookie, "Ollama smoke account setup failed.");

  const status = await request(`/api/ai/status?projectId=${encodeURIComponent(projectId)}`);
  assert(status.response.status === 200, "Ollama status route did not return HTTP 200.");
  assert(status.payload.providerStatus?.provider === "ollama", "Ollama status did not identify the provider.");
  assert(status.payload.providerStatus?.state === "configured", "Ollama status was not configured.");
  assert(status.payload.providerStatus?.model === model, "Ollama status returned the wrong model.");
  assert(observedRequests.length === 0, "Ollama status unexpectedly called the chat endpoint.");

  mode = "success";
  const success = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ projectId, message: "Return the local provider answer.", messageId: "ollama-success" }),
  });
  assert(success.response.status === 200, "Ollama success response was not HTTP 200.");
  assert(success.payload.source === "model-assisted" && success.payload.provider === "ollama", "Ollama success was not model-assisted.");
  assert(success.payload.model === model, "Ollama success returned the wrong model.");
  assert(success.payload.content === "Visible Ollama answer.", "Ollama thinking content was not removed safely.");
  assert(!success.payload.content.includes("private") && !success.payload.content.includes("evidence:not-real"), "Private thinking content leaked.");
  assert(success.payload.usage?.promptTokens === 12 && success.payload.usage?.completionTokens === 9 && success.payload.usage?.totalTokens === 21, "Ollama usage was not normalized.");
  assert(success.payload.contextSource === "server-owned", "Ollama chat did not use server-owned context.");
  assert(success.payload.workspace.messages.some((message) => message.id === "ollama-success"), "Ollama response was not persisted.");
  const successRequest = observedRequests.at(-1);
  assert(successRequest.stream === false && successRequest.think === false, "Ollama request was not non-streaming or thinking-disabled.");
  assert(successRequest.options?.num_predict === 900 && successRequest.options?.temperature === 0.2, "Ollama generation bounds were not sent.");

  mode = "malformed";
  const malformed = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ projectId, message: "malformed Ollama response", messageId: "ollama-malformed" }),
  });
  assert(malformed.response.status === 200 && malformed.payload.source === "deterministic-fallback", "Malformed Ollama output did not fall back.");
  assert(malformed.payload.providerStatus?.reason === "invalid-response", "Malformed Ollama output returned the wrong reason.");

  mode = "timeout";
  const timeout = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ projectId, message: "timeout Ollama response", messageId: "ollama-timeout" }),
  });
  assert(timeout.response.status === 200 && timeout.payload.source === "deterministic-fallback", "Ollama timeout did not fall back.");
  assert(timeout.payload.providerStatus?.reason === "timeout", "Ollama timeout returned the wrong reason.");

  mode = "unavailable";
  const unavailable = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ projectId, message: "unavailable Ollama response", messageId: "ollama-unavailable" }),
  });
  assert(unavailable.response.status === 200 && unavailable.payload.source === "deterministic-fallback", "Unavailable Ollama did not fall back.");
  assert(unavailable.payload.providerStatus?.reason === "transient-error", "Unavailable Ollama returned the wrong reason.");

  console.log("Ollama adapter smoke checks passed against a local mocked Ollama endpoint; no live Ollama request was made.");
} catch (error) {
  const detail = output.join("").slice(-2_000);
  throw new Error(`${error instanceof Error ? error.message : "Ollama smoke failed."}${detail ? `\n${detail}` : ""}`);
} finally {
  ollamaServer.close();
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    await new Promise((resolve) => killer.once("close", resolve));
  } else {
    child.kill("SIGTERM");
  }
  await rm(dataFile, { force: true });
}
