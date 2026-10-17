import {
  MAX_PAGE_BYTES,
  PageRetrievalError,
  assertSafePublicUrl,
  retrievePublicPage,
} from "../src/lib/research/retrieval.ts";
import { searchWithBrave } from "../src/lib/research/brave.ts";
import { runBoundedResearch } from "../src/lib/research/engine.ts";
import { detectResearchIntent } from "../src/lib/research/intent.ts";

async function expectCode(action, expectedCode) {
  try {
    await action();
  } catch (error) {
    if (error instanceof PageRetrievalError && error.code === expectedCode) return;
    throw new Error(`Expected retrieval error ${expectedCode}.`);
  }
  throw new Error(`Expected retrieval error ${expectedCode}.`);
}

await expectCode(
  () => assertSafePublicUrl("http://127.0.0.1:8080/health", async () => ["127.0.0.1"]),
  "blocked-host",
);

await expectCode(
  () => assertSafePublicUrl("http://[::ffff:c0a8:0101]/health", async () => ["::ffff:c0a8:0101"]),
  "blocked-host",
);

await expectCode(
  () => assertSafePublicUrl("https://docs.example.test:444/guide", async () => ["93.184.216.34"]),
  "invalid-url",
);

const publicUrl = await assertSafePublicUrl("https://docs.example.test/guide", async () => ["93.184.216.34"]);
if (publicUrl.hostname !== "docs.example.test") throw new Error("Public URL validation changed the hostname.");

await expectCode(
  () => retrievePublicPage("https://docs.example.test/start", {
    resolveHost: async (hostname) => hostname === "docs.example.test" ? ["93.184.216.34"] : ["127.0.0.1"],
    fetcher: async () => new Response("", { status: 302, headers: { location: "http://127.0.0.1/private" } }),
  }),
  "blocked-host",
);

await expectCode(
  () => retrievePublicPage("https://docs.example.test/large", {
    resolveHost: async () => ["93.184.216.34"],
    fetcher: async () => new Response("", { status: 200, headers: { "content-type": "text/plain", "content-length": String(MAX_PAGE_BYTES + 1) } }),
  }),
  "too-large",
);

const page = await retrievePublicPage("https://docs.example.test/guide", {
  resolveHost: async () => ["93.184.216.34"],
  fetcher: async () => new Response("<html><title>Docs</title><script>ignore this</script><p>Hello &amp; world.</p></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  }),
});
if (page.title !== "Docs" || page.text !== "Docs Hello & world.") throw new Error("Readable page extraction check failed.");

const intent = detectResearchIntent("Compare Next.js and Vite for a current project");
if (!intent.shouldResearch || intent.intent !== "comparison" || intent.queries.length < 2) {
  throw new Error("Research intent detection check failed.");
}

let boundedSearches = 0;
const bounded = await runBoundedResearch("Compare two current frontend options", async (query) => {
  boundedSearches += 1;
  const sourceId = `source-${boundedSearches}`;
  const evidenceId = `evidence-${boundedSearches}`;
  return {
    status: "available",
    provider: "brave-search",
    message: "mocked search",
    findings: [{
      id: `finding-${boundedSearches}`,
      title: query,
      url: `https://docs.example.test/${boundedSearches}`,
      snippet: `Evidence for ${query}`,
      retrievedAt: new Date().toISOString(),
      provider: "brave-search",
      verificationStatus: "page-retrieved-not-yet-verified",
      sourceId,
      evidenceId,
      pageRetrieved: true,
    }],
    sources: [{ id: sourceId, title: query, url: `https://docs.example.test/${boundedSearches}`, canonicalUrl: `https://docs.example.test/${boundedSearches}`, retrievedAt: new Date().toISOString(), provider: "brave-search", retrievalStatus: "page-retrieved" }],
    evidence: [{ id: evidenceId, sourceId, kind: "retrieved-page", text: `Evidence for ${query}`, capturedAt: new Date().toISOString(), verificationStatus: "page-retrieved" }],
    retrieval: { searched: 1, pageAttempts: 1, pagesRetrieved: 1, pagesFailed: 0 },
  };
}, { maxSearches: 2, maxPagesPerSearch: 1, maxResultsPerSearch: 2 });
if (boundedSearches !== 2 || bounded.findings.length !== 2 || bounded.evidence?.length !== 2) {
  throw new Error("Bounded research orchestration check failed.");
}

let braveAttempts = 0;
const retried = await searchWithBrave("retry test", 1, {
  apiKey: "mock-brave-key",
  pageAttempts: 0,
  retryDelayMs: 0,
  fetcher: async () => {
    braveAttempts += 1;
    if (braveAttempts === 1) return new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
    return new Response(JSON.stringify({ web: { results: [{ title: "Retry result", url: "https://docs.example.test/retry", description: "A retryable result." }] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
if (braveAttempts !== 2 || retried.status !== "available" || retried.findings.length !== 1 || retried.findings[0].query !== "retry test") {
  throw new Error("Bounded search retry and normalization check failed.");
}

console.log("Research safety smoke checks passed.");
