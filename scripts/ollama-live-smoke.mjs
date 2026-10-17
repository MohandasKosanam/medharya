import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const appPort = Number(process.env.MEDHARYA_OLLAMA_LIVE_PORT ?? 3024);
const baseUrl = `http://127.0.0.1:${appPort}`;
const ollamaBaseUrl = process.env.MEDHARYA_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const model = process.env.MEDHARYA_OLLAMA_MODEL ?? "qwen3:4b";
const dataFile = join(tmpdir(), `medharya-ollama-live-${Date.now()}.json`);

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
    MEDHARYA_OLLAMA_BASE_URL: ollamaBaseUrl,
    MEDHARYA_OLLAMA_MODEL: model,
    MEDHARYA_OLLAMA_TIMEOUT_MS: process.env.MEDHARYA_OLLAMA_TIMEOUT_MS ?? "45000",
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
    // The status is enough for the error below.
  }
  return { response, payload };
}

async function waitForApp() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Medharya production server exited early.\n${output.join("").slice(-2_000)}`);
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.status === 200) return;
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the Medharya production server.");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await waitForApp();

  const email = `ollama-live-${Date.now()}@example.com`;
  const anonymous = await request("/api/auth/anonymous-draft", {
    method: "POST",
    body: JSON.stringify({
      idea: "Verify the live local Qwen3-4B Ollama integration",
      category: "AI application",
      budgetInr: 0,
      experienceLevel: "Intermediate",
      preferredTechnologies: ["TypeScript"],
      deploymentPreference: "Local development only",
      additionalRequirements: "Use the local Ollama provider server-side.",
      submittedAt: new Date().toISOString(),
    }),
  });
  assert(anonymous.response.status === 200 && typeof anonymous.payload.draft?.id === "string", "Live Ollama draft setup failed.");

  const signup = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password: "ollama-live-password-123", anonymousDraftId: anonymous.payload.draft.id }),
  });
  const projectId = signup.payload.project?.id;
  assert(signup.response.status === 201 && typeof projectId === "string" && cookie, "Live Ollama account setup failed.");

  const status = await request(`/api/ai/status?projectId=${encodeURIComponent(projectId)}`);
  assert(status.response.status === 200, `Live Ollama status request failed with HTTP ${status.response.status}.`);
  assert(status.payload.providerStatus?.provider === "ollama", "Live status did not identify Ollama.");
  assert(status.payload.providerStatus?.state === "ready", "Live status was not ready before inference.");

  const chat = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      message: "Reply with one concise sentence confirming this local Qwen3-4B integration reached Ollama.",
      messageId: `ollama-live-${Date.now()}`,
    }),
  });
  assert(chat.response.status === 200, `Live Ollama chat failed with HTTP ${chat.response.status}.`);
  assert(
    chat.payload.source === "model-assisted",
    `Live Ollama chat did not return model-assisted output: ${JSON.stringify({
      source: chat.payload.source,
      provider: chat.payload.provider,
      model: chat.payload.model,
      providerStatus: chat.payload.providerStatus,
      notice: chat.payload.notice,
    })}`,
  );
  assert(chat.payload.provider === "ollama", "Live chat did not identify Ollama.");
  assert(chat.payload.model === model, `Live chat returned model ${chat.payload.model ?? "<missing>"}, expected ${model}.`);
  assert(["ready", "degraded"].includes(chat.payload.providerStatus?.state), "Live Ollama inference did not produce an observed provider state.");
  assert(chat.payload.contextSource === "server-owned", "Live chat did not use server-owned context.");
  assert(typeof chat.payload.content === "string" && chat.payload.content.trim(), "Live Ollama response had no visible content.");
  assert(chat.payload.workspace?.messages?.some((message) => message.role === "assistant"), "Live Ollama response was not persisted.");

  const greeting = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      message: "hello",
      messageId: `ollama-live-greeting-${Date.now()}`,
    }),
  });
  assert(greeting.response.status === 200, "Live Ollama greeting failed with HTTP 200.");
  assert(greeting.payload.source === "model-assisted", "Live Ollama greeting did not use model-assisted output.");
  assert(typeof greeting.payload.content === "string" && greeting.payload.content.trim(), "Live Ollama greeting had no visible content.");
  assert(!String(greeting.payload.notice ?? "").includes("Automatic research"), "Live Ollama greeting unexpectedly triggered research.");

  console.log(JSON.stringify({
    live: true,
    provider: chat.payload.provider,
    model: chat.payload.model,
    source: chat.payload.source,
    contextSource: chat.payload.contextSource,
    inferenceStatus: chat.payload.providerStatus.state,
    identityVerified: chat.payload.providerStatus.identityVerified ?? false,
    contentChars: chat.payload.content.length,
    greetingSource: greeting.payload.source,
    greetingContentChars: greeting.payload.content.length,
    statusBeforeInference: status.payload.providerStatus.state,
    workspacePersisted: true,
  }));
} catch (error) {
  const detail = output.join("").slice(-2_000);
  throw new Error(`${error instanceof Error ? error.message : "Live Ollama smoke failed."}${detail ? `\n${detail}` : ""}`);
} finally {
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    await new Promise((resolve) => killer.once("close", resolve));
  } else {
    child.kill("SIGTERM");
  }
  await rm(dataFile, { force: true });
}
