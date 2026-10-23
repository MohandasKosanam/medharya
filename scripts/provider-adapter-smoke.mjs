import { register } from "node:module";

const sourceRoot = new URL("../src/", import.meta.url).href;
const loaderSource = [
  `const sourceRoot = ${JSON.stringify(sourceRoot)};`,
  "export async function resolve(specifier, context, nextResolve) {",
  '  if (specifier.startsWith("@/")) return nextResolve(new URL(specifier.slice(2) + ".ts", sourceRoot).href, context);',
  '  if (specifier.startsWith(".") && !/\\.[^/]+$/.test(specifier)) {',
  "    try { return await nextResolve(specifier, context); }",
  '    catch (error) { if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error; return nextResolve(specifier + ".ts", context); }',
  "  }",
  "  return nextResolve(specifier, context);",
  "}",
].join("\n");
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);

const { createOpenRouterProvider, getOpenRouterConfigurationDiagnostics, requestOpenRouter } = await import("../src/lib/providers/openrouter.ts");
const { searchWithTinyFish } = await import("../src/lib/research/tinyfish.ts");

const prompt = {
  system: "You are a test assistant.",
  context: "Project context.",
  recentMessages: [],
  userMessage: "Say hello.",
};

let openRouterCalls = 0;
const openRouter = await requestOpenRouter(
  { apiKey: "test-openrouter-key", model: "openai/gpt-4o-mini", baseUrl: "https://openrouter.ai/api/v1", timeoutMs: 2_000 },
  prompt,
  async (input, init) => {
    openRouterCalls += 1;
    if (input !== "https://openrouter.ai/api/v1/chat/completions") throw new Error("OpenRouter endpoint was not normalized correctly.");
    if (init?.headers?.Authorization !== "Bearer test-openrouter-key") throw new Error("OpenRouter authorization header was not sent.");
    if (openRouterCalls === 1) return new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
    return new Response(JSON.stringify({
      choices: [{ message: { content: "OpenRouter response" } }],
      model: "openai/gpt-4o-mini",
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  },
);

if (openRouter.status !== "available" || openRouter.provider !== "openrouter" || openRouter.text !== "OpenRouter response" || openRouter.usage?.totalTokens !== 5 || openRouterCalls !== 2) {
  throw new Error("OpenRouter adapter did not normalize the documented chat-completions contract or bounded retry.");
}

const missingOpenRouter = await requestOpenRouter({ model: "openai/gpt-4o-mini" }, prompt);
if (missingOpenRouter.status !== "unavailable" || missingOpenRouter.reason !== "missing-config") {
  throw new Error("OpenRouter missing-credential handling was not safe.");
}

const openRouterHealth = createOpenRouterProvider({
  apiKey: "test-openrouter-key",
  model: "openai/gpt-4o-mini",
  baseUrl: "https://openrouter.ai/api/v1",
  request: async (input, init) => {
    if (input !== "https://openrouter.ai/api/v1/model/openai/gpt-4o-mini" || init?.method !== "GET") {
      throw new Error("OpenRouter model health endpoint was not normalized correctly.");
    }
    if (init.headers?.Authorization !== "Bearer test-openrouter-key") {
      throw new Error("OpenRouter model health authorization header was not sent.");
    }
    return new Response(JSON.stringify({ data: { id: "openai/gpt-4o-mini" } }), { status: 200 });
  },
});
const openRouterHealthStatus = await openRouterHealth.health();
if (openRouterHealthStatus.state !== "ready" || openRouterHealthStatus.identityVerified !== true || openRouterHealthStatus.provider !== "openrouter") {
  throw new Error("OpenRouter model health verification did not return the expected ready state.");
}

const openRouterDiagnostics = getOpenRouterConfigurationDiagnostics({
  MEDHARYA_AI_PROVIDER: "openrouter",
  OPENROUTER_API_KEY: "test-openrouter-key",
  OPENROUTER_MODEL: "openai/gpt-4o-mini",
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  OPENROUTER_TIMEOUT_MS: "15000",
});
if (
  !openRouterDiagnostics.selected
  || !openRouterDiagnostics.ready
  || !openRouterDiagnostics.apiKeyConfigured
  || openRouterDiagnostics.model !== "openai/gpt-4o-mini"
  || openRouterDiagnostics.baseUrl !== "https://openrouter.ai/api/v1"
  || openRouterDiagnostics.missing.length
) {
  throw new Error("OpenRouter configuration diagnostics did not report a safe ready state.");
}

const incompleteOpenRouterDiagnostics = getOpenRouterConfigurationDiagnostics({
  MEDHARYA_AI_PROVIDER: "openrouter",
  OPENROUTER_MODEL: "openai/gpt-4o-mini",
});
if (
  incompleteOpenRouterDiagnostics.ready
  || !incompleteOpenRouterDiagnostics.missing.includes("OPENROUTER_API_KEY")
  || incompleteOpenRouterDiagnostics.baseUrl !== "https://openrouter.ai/api/v1"
) {
  throw new Error("OpenRouter configuration diagnostics did not report missing configuration safely.");
}

const tinyfishCalls = [];
const research = await searchWithTinyFish("current TinyFish API docs", 2, {
  apiKey: "test-tinyfish-key",
  now: () => "2026-10-22T00:00:00.000Z",
  fetcher: async (input, init) => {
    tinyfishCalls.push({ input, init });
    if (input.startsWith("https://api.search.tinyfish.ai")) {
      return new Response(JSON.stringify({
        query: "current TinyFish API docs",
        results: [{
          position: 1,
          site_name: "docs.tinyfish.ai",
          title: "TinyFish Search API",
          snippet: "Search the live web and receive structured results.",
          url: "https://docs.tinyfish.ai/search-api",
        }],
        total_results: 1,
        page: 0,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (input === "https://api.fetch.tinyfish.ai" && init?.method === "POST") {
      return new Response(JSON.stringify({
        results: [{
          url: "https://docs.tinyfish.ai/search-api",
          final_url: "https://docs.tinyfish.ai/search-api",
          title: "TinyFish Search API",
          format: "markdown",
          text: "The TinyFish Search API returns structured results from the live web.",
        }],
        errors: [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected TinyFish endpoint: ${input}`);
  },
});

if (research.status !== "available" || research.provider !== "tinyfish-search" || research.findings.length !== 1 || research.findings[0].pageRetrieved !== true || research.evidence?.some((record) => record.verificationStatus === "page-retrieved") !== true) {
  throw new Error("TinyFish Search + Fetch results were not normalized with provenance.");
}
if (tinyfishCalls.length !== 2 || tinyfishCalls.some(({ init }) => init?.headers?.["X-API-Key"] !== "test-tinyfish-key")) {
  throw new Error("TinyFish API requests did not use the server-side API-key contract.");
}

const missingTinyFish = await searchWithTinyFish("current docs", 2, { apiKey: "" });
if (missingTinyFish.status !== "unavailable" || !missingTinyFish.message.includes("TINYFISH_API_KEY")) {
  throw new Error("TinyFish missing-credential handling was not safe.");
}

console.log("OpenRouter and TinyFish adapter smoke checks passed offline.");
