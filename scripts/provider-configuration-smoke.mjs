import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { getProviderStartupDiagnostics } from "../src/lib/providers/startup.ts";
import { getTogetherConfigurationDiagnostics, requestTogether } from "../src/lib/providers/together.ts";
import { selectModelProvider, selectedModelProviderStatus } from "../src/lib/providers/openai-compatible.ts";

// Synthetic inputs only. Never load the user's environment or contact a provider.
const env = {
  MEDHARYA_AI_PROVIDER: "together",
  TOGETHER_API_KEY: "fixture-key-not-a-credential",
  TOGETHER_MODEL: "fixture-org/selected-model",
};
const prompt = { system: "Offline test", context: "", recentMessages: [], userMessage: "Hello" };
let cases = 0;
async function check(name, run) {
  try {
    await run();
    cases += 1;
  } catch (error) {
    // Avoid dumping entire configuration/response objects even on assertion failure.
    const code = error?.code === "ERR_ASSERTION" ? "assertion" : error instanceof SyntaxError ? "invalid-child-json" : "child-process";
    throw new Error(`Provider configuration check failed: ${name} (${code})`);
  }
}

await check("valid selection and startup state", () => {
  const report = getProviderStartupDiagnostics(env);
  assert.equal(report.provider, "together-ai");
  assert.equal(report.state, "configured");
  assert.equal(report.together.ready, true);
  assert.equal(report.identityVerified, false);
  assert.equal(report.inferenceVerified, false);
  assert.equal(selectModelProvider({ env }).model, env.TOGETHER_MODEL);
});

await check("presence diagnostics never serialize raw values", () => {
  const canary = "DO-NOT-LOG-fixture-value";
  const raw = {
    ...env, TOGETHER_API_KEY: canary, TOGETHER_MODEL: canary,
    TOGETHER_BASE_URL: `https://user:${canary}@example.test/v1?key=${canary}`,
    TOGETHER_TIMEOUT_MS: canary,
  };
  for (const configuration of [raw, { ...raw, MEDHARYA_AI_PROVIDER: canary }]) {
    const text = JSON.stringify(getProviderStartupDiagnostics(configuration));
    assert.equal(text.includes(canary), false);
    assert.equal(text.includes("example.test"), false);
    assert.equal(text.includes('"model":'), false);
    assert.equal(text.includes('"baseUrl":'), false);
  }
});

await check("missing key and model are explicit", () => {
  const report = getProviderStartupDiagnostics({ MEDHARYA_AI_PROVIDER: "together" });
  assert.deepEqual(report.together.missing, ["TOGETHER_API_KEY", "TOGETHER_MODEL"]);
  assert.equal(report.state, "unavailable");
  assert.equal(selectModelProvider({ env: { MEDHARYA_AI_PROVIDER: "together" } }), null);
});

for (const provider of ["disabled", "none", "off"]) {
  await check(`disabled provider ${provider}`, () => {
    const disabled = { ...env, MEDHARYA_AI_PROVIDER: provider };
    assert.equal(getProviderStartupDiagnostics(disabled).together.ready, false);
    assert.equal(selectModelProvider({ env: disabled }), null);
  });
}
await check("global disable", () => {
  const disabled = { ...env, MEDHARYA_DISABLE_EXTERNAL_PROVIDERS: "1" };
  assert.equal(getProviderStartupDiagnostics(disabled).together.selected, false);
  assert.equal(selectModelProvider({ env: disabled }), null);
});

await check("explicit generic provider cannot be overridden by Together credentials", () => {
  const generic = { ...env, MEDHARYA_AI_PROVIDER: "openai-compatible", MEDHARYA_AI_API_KEY: "mock", MEDHARYA_AI_MODEL: "generic-model" };
  assert.equal(selectedModelProviderStatus({ env: generic }).provider, "openai-compatible");
  assert.equal(selectModelProvider({ env: generic }).model, "generic-model");
  assert.equal(getProviderStartupDiagnostics(generic).together.selected, false);
});

await check("implicit selection requires canonical Together credentials", () => {
  assert.equal(selectedModelProviderStatus({ env: { ...env, MEDHARYA_AI_PROVIDER: "" } }).provider, "together-ai");
  const generic = { MEDHARYA_AI_API_KEY: "mock", MEDHARYA_AI_MODEL: "generic-model" };
  assert.equal(getProviderStartupDiagnostics(generic).together.selected, false);
});

await check("canonical model is preserved and blank aliases are handled", () => {
  assert.equal(selectModelProvider({ env: { ...env, MEDHARYA_TOGETHER_MODEL: "alternate-model" } }).model, env.TOGETHER_MODEL);
  const aliases = { MEDHARYA_AI_PROVIDER: "together", TOGETHER_API_KEY: " ", TOGETHER_MODEL: " ", MEDHARYA_AI_API_KEY: "mock", MEDHARYA_AI_MODEL: "alias-model" };
  assert.equal(selectModelProvider({ env: aliases }).model, "alias-model");
});

for (const baseUrl of ["invalid", "http://remote.example.test/v1", "https://user:password@example.test/v1", "https://example.test/v1?key=mock", "https://example.test/v1#mock"]) {
  await check("invalid URL blocks status, factory, and transport", async () => {
    const invalid = { ...env, TOGETHER_BASE_URL: baseUrl };
    assert.equal(selectedModelProviderStatus({ env: invalid }).state, "unavailable");
    assert.equal(selectModelProvider({ env: invalid }), null);
    let calls = 0;
    const result = await requestTogether({ apiKey: env.TOGETHER_API_KEY, model: env.TOGETHER_MODEL, baseUrl }, prompt, async () => { calls += 1; throw new Error("No transport expected"); });
    assert.equal(calls, 0);
    assert.equal(result.reason, "missing-config");
  });
}

for (const timeout of ["NaN", "Infinity", "0", "-1"]) {
  await check("invalid timeout blocks configuration", () => {
    const invalid = { ...env, TOGETHER_TIMEOUT_MS: timeout };
    assert.equal(getProviderStartupDiagnostics(invalid).together.timeoutConfigured, false);
    assert.equal(selectedModelProviderStatus({ env: invalid }).state, "unavailable");
    assert.equal(selectModelProvider({ env: invalid }), null);
  });
}
for (const [timeout, expected] of [["", 15000], ["1", 2000], ["15000", 15000], ["90000", 45000]]) {
  await check("timeout bounds", () => {
    assert.equal(getTogetherConfigurationDiagnostics({ ...env, TOGETHER_TIMEOUT_MS: timeout }).timeoutMs, expected);
  });
}

await check("selected Together path executes only the mock and preserves model identity", async () => {
  let calls = 0;
  const provider = selectModelProvider({ env, request: async (url, init) => {
    calls += 1;
    assert.equal(url, "https://api.together.ai/v1/chat/completions");
    assert.equal(JSON.parse(init.body).model, env.TOGETHER_MODEL);
    return new Response(JSON.stringify({ model: env.TOGETHER_MODEL, choices: [{ message: { content: "Offline response" } }] }));
  } });
  const result = await provider.complete(prompt);
  assert.equal(result.status, "available");
  assert.equal(result.provider, "together-ai");
  assert.equal(result.identityVerified, true);
  assert.equal(calls, 1);
});

const loader = new URL("./register-ts-loader.mjs", import.meta.url).href;
const configurationUrl = new URL("../src/lib/providers/openai-compatible.ts", import.meta.url).href;
const instrumentationUrl = new URL("../src/instrumentation.ts", import.meta.url).href;
const cleanChildEnv = Object.fromEntries(["PATH", "SystemRoot", "TEMP", "TMP"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
function childRun(code, overrides = {}) {
  const child = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", "--import", loader, "--input-type=module", "-e", code], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...cleanChildEnv, NODE_ENV: "development", ...overrides },
    encoding: "utf8", timeout: 20000,
  });
  // Child output is intentionally never printed on failure.
  if (child.status !== 0) {
    const knownError = /ERR_[A-Z_]+/.exec(child.stderr ?? "")?.[0] ?? "unclassified";
    console.error(`Isolated configuration process: exit=${child.status}; error=${knownError}`);
  }
  assert.equal(child.status, 0, "Isolated configuration process failed");
  return JSON.parse(child.stdout.trim());
}

// Real Next.js dotenv loader, fake values, isolated directory/process. The real
// repository .env.local is never read, replaced, or created by this check.
const fixture = await mkdtemp(join(tmpdir(), "medharya-provider-env-"));
try {
  await writeFile(join(fixture, ".env"), "MEDHARYA_AI_PROVIDER=together\nTOGETHER_API_KEY=fixture-key\nTOGETHER_MODEL=base-model\n");
  await writeFile(join(fixture, ".env.development"), "TOGETHER_MODEL=development-model\n");
  await writeFile(join(fixture, ".env.local"), "TOGETHER_MODEL=local-model\n");
  await writeFile(join(fixture, ".env.test"), "TOGETHER_MODEL=test-model\n");
  const loadFixture = `
    import nextEnv from '@next/env';
    import { selectModelProvider, selectedModelProviderStatus } from ${JSON.stringify(configurationUrl)};
    nextEnv.loadEnvConfig(${JSON.stringify(fixture)}, true, { info(){}, error(){ throw new Error('fixture load failed'); } });
    globalThis.fetch = async () => { throw new Error('No external request allowed'); };
    const provider = selectModelProvider();
    const status = selectedModelProviderStatus();
    console.log(JSON.stringify({ model: provider?.model, provider: status.provider, state: status.state }));
  `;
  await check("Next loads root .env.local before .env.development and .env", () => {
    assert.deepEqual(childRun(loadFixture), { model: "local-model", provider: "together-ai", state: "configured" });
  });
  await writeFile(join(fixture, ".env.development.local"), "TOGETHER_MODEL=development-local-model\n");
  await check("Next environment-specific local file takes priority", () => {
    assert.equal(childRun(loadFixture).model, "development-local-model");
  });
  await check("inherited process environment takes priority over dotenv", () => {
    assert.equal(childRun(loadFixture, { TOGETHER_MODEL: "inherited-model" }).model, "inherited-model");
  });
  await check("Next test mode skips .env.local", () => {
    assert.equal(childRun(loadFixture, { NODE_ENV: "test" }).model, "test-model");
  });
} finally {
  await rm(fixture, { force: true, recursive: true });
}

await check("instrumentation runtime gates, one-time logging, no network or raw values", () => {
  const result = childRun(`
    import assert from 'node:assert/strict';
    import { register } from ${JSON.stringify(instrumentationUrl)};
    const lines = [];
    console.info = (...args) => lines.push(args.join(' '));
    globalThis.fetch = async () => { throw new Error('No network allowed'); };
    await register();
    process.env.NEXT_RUNTIME = 'edge';
    await register();
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NODE_ENV = 'test';
    await register();
    assert.equal(lines.length, 0);
    process.env.NODE_ENV = 'development';
    process.env.MEDHARYA_AI_PROVIDER = 'together';
    process.env.TOGETHER_API_KEY = 'never-log-fixture-canary';
    process.env.TOGETHER_MODEL = 'never-log-fixture-canary';
    process.env.TOGETHER_BASE_URL = 'https://example.test/never-log-fixture-canary';
    await Promise.all([register(), register()]);
    await register();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].includes('never-log-fixture-canary'), false);
    assert.equal(lines[0].includes('example.test'), false);
    assert.equal(lines[0].includes('"inferenceVerified":false'), true);
    console.log(JSON.stringify({ passed: true }));
  `);
  assert.equal(result.passed, true);
});

console.log(`Provider configuration smoke: ${cases} offline checks passed; no live provider request was made.`);
