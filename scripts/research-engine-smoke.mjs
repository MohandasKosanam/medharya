import { register } from "node:module";

// The application is bundled with Next's TypeScript resolver. Register the
// smallest equivalent resolver so this smoke test can import the same modules
// directly with Node's built-in TypeScript stripping.
const sourceRoot = new URL("../src/", import.meta.url).href;
const loaderSource = [
  `const sourceRoot = ${JSON.stringify(sourceRoot)};`,
  "export async function resolve(specifier, context, nextResolve) {",
  '  if (specifier.startsWith("@/")) {',
  '    return nextResolve(new URL(specifier.slice(2) + ".ts", sourceRoot).href, context);',
  "  }",
  '  if (specifier.startsWith(".") && !/\\.[^/]+$/.test(specifier)) {',
  "    try {",
  "      return await nextResolve(specifier, context);",
  "    } catch (error) {",
  '      if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;',
  '      return nextResolve(specifier + ".ts", context);',
  "    }",
  "  }",
  "  return nextResolve(specifier, context);",
  "}",
].join("\n");
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);

const { RESEARCH_LIMITS, runBoundedResearch } = await import("../src/lib/research/engine.ts");
const { detectResearchIntent } = await import("../src/lib/research/intent.ts");
const { assessResearchEvidence } = await import("../src/lib/research/evidence.ts");
const { generateDeterministicAssistantReply } = await import("../src/lib/assistant.ts");

const retrievedAt = "2026-01-01T00:00:00.000Z";

function finding({ id, title, url, query, sourceId, evidenceId }) {
  return {
    id,
    title,
    url,
    snippet: `Offline evidence for ${title}.`,
    retrievedAt,
    provider: "brave-search",
    verificationStatus: "retrieved-not-yet-verified",
    query,
    sourceId,
    evidenceId,
    evidenceKind: "search-snippet",
    pageRetrieved: false,
  };
}

function source({ sourceId, title, url }) {
  return {
    id: sourceId,
    title,
    url,
    canonicalUrl: url,
    retrievedAt,
    provider: "brave-search",
    retrievalStatus: "snippet-only",
  };
}

function evidence({ id, sourceId, text }) {
  return {
    id,
    sourceId,
    kind: "search-snippet",
    text,
    capturedAt: retrievedAt,
    verificationStatus: "snippet-only",
  };
}

function availableResponse(query, records, citations = []) {
  return {
    status: "available",
    provider: "brave-search",
    message: "Offline provider response.",
    findings: records.map((record) => finding({ ...record, query })),
    sources: records.map((record) => source(record)),
    evidence: records.map((record) => evidence({
      id: record.evidenceId,
      sourceId: record.sourceId,
      text: `Evidence captured for ${record.title}.`,
    })),
    citations,
    retrieval: { searched: records.length, pageAttempts: 1, pagesRetrieved: 0, pagesFailed: 0 },
  };
}

function assertSearchBudget(calls, limits, label) {
  if (calls.length > limits.maxSearches) {
    throw new Error(`${label} exceeded the search-call limit.`);
  }
  if (calls.some((call) => call.limit > limits.maxResultsPerSearch || (call.pageAttempts ?? 0) > limits.maxPagesPerSearch)) {
    throw new Error(`${label} passed an over-sized result or page limit to the injected search.`);
  }
}

const currentFacts = detectResearchIntent("What is the current availability of Node.js 22?");
if (
  !currentFacts.shouldResearch
  || currentFacts.intent !== "current-facts"
  || currentFacts.queries.length !== 2
  || currentFacts.queries[1] !== "What is the current availability of Node.js 22? official source"
) {
  throw new Error("Current-facts intent detection did not produce the expected bounded queries.");
}

const redacted = detectResearchIntent("What is the current pricing? api_key=sk-live-super-secret-value");
if (redacted.queries.some((query) => query.includes("super-secret-value") || query.includes("sk-live"))) {
  throw new Error("Research query sanitization exposed a credential-shaped value.");
}

const constrainedCalls = [];
await runBoundedResearch(
  "What is the current availability of Node.js 22?",
  async (query, limit, options) => {
    constrainedCalls.push({ query, limit, pageAttempts: options?.pageAttempts });
    return availableResponse(query, [{
      id: "finding-constrained",
      title: "Constrained result",
      url: "https://docs.example.test/constrained",
      sourceId: "source-constrained",
      evidenceId: "evidence-constrained",
    }]);
  },
  { maxSearches: 1, maxPagesPerSearch: 1, maxResultsPerSearch: 2 },
);
if (constrainedCalls.length !== 1 || constrainedCalls[0].limit !== 2 || constrainedCalls[0].pageAttempts !== 1) {
  throw new Error("Configured search and page limits were not passed to the injected search.");
}
assertSearchBudget(constrainedCalls, { maxSearches: 1, maxPagesPerSearch: 1, maxResultsPerSearch: 2 }, "Configured research");

const totalEvidenceLimited = await runBoundedResearch(
  "What is the current status of the bounded evidence test?",
  async (query) => availableResponse(query, [
    { id: "finding-limit-a", title: "Limit A", url: "https://docs.example.test/limit-a", sourceId: "source-limit-a", evidenceId: "evidence-limit-a" },
    { id: "finding-limit-b", title: "Limit B", url: "https://docs.example.test/limit-b", sourceId: "source-limit-b", evidenceId: "evidence-limit-b" },
  ]),
  { maxSearches: 1, maxTotalEvidence: 1 },
);
if (totalEvidenceLimited.findings.length !== 1 || totalEvidenceLimited.evidence?.length !== 1) {
  throw new Error("Total research evidence limit was not enforced.");
}

const clampedCalls = [];
await runBoundedResearch(
  "Debug the current framework failure",
  async (query, limit, options) => {
    clampedCalls.push({ query, limit, pageAttempts: options?.pageAttempts });
    return availableResponse(query, []);
  },
  {
    maxSearches: RESEARCH_LIMITS.maxSearches + 99,
    maxPagesPerSearch: RESEARCH_LIMITS.maxPagesPerSearch + 99,
    maxResultsPerSearch: RESEARCH_LIMITS.maxResultsPerSearch + 99,
  },
);
if (
  clampedCalls.length !== RESEARCH_LIMITS.maxSearches
  || clampedCalls.some((call) => call.limit !== RESEARCH_LIMITS.maxResultsPerSearch || call.pageAttempts !== RESEARCH_LIMITS.maxPagesPerSearch)
) {
  throw new Error("Research limits were not clamped before invoking the injected search.");
}
assertSearchBudget(clampedCalls, RESEARCH_LIMITS, "Clamped research");

let unavailableCalls = 0;
const unavailable = await runBoundedResearch(
  "What is the current availability of the offline provider?",
  async () => {
    unavailableCalls += 1;
    return {
      status: "unavailable",
      provider: "brave-search",
      message: "Offline provider is unavailable.",
      findings: [],
    };
  },
);
if (
  unavailable.status !== "unavailable"
  || unavailable.message !== "Offline provider is unavailable."
  || unavailable.findings.length !== 0
  || unavailable.intent?.intent !== "current-facts"
  || unavailableCalls !== 1
) {
  throw new Error("Unavailable research did not return a graceful provider result.");
}

const mergeCalls = [];
const merged = await runBoundedResearch(
  "What is the current status of the web research guide?",
  async (query, limit, options) => {
    mergeCalls.push({ query, limit, pageAttempts: options?.pageAttempts });
    if (mergeCalls.length === 1) {
      return availableResponse(
        query,
        [{
          id: "finding-guide-first",
          title: "Research guide",
          url: "https://docs.example.test/guide?utm_source=first#overview",
          sourceId: "source-guide",
          evidenceId: "evidence-guide",
        }],
        [
          { evidenceId: "evidence-guide", sourceId: "forged-source", title: "Forged citation", url: "https://attacker.example/", retrievedAt },
          { evidenceId: "missing-evidence", sourceId: "missing-source", title: "Ignored", url: "https://attacker.example/ignored", retrievedAt },
        ],
      );
    }
    return availableResponse(
      query,
      [
        {
          id: "finding-guide-duplicate",
          title: "Research guide duplicate",
          url: "https://docs.example.test/guide?utm_medium=second#details",
          sourceId: "source-guide",
          evidenceId: "evidence-guide",
        },
        {
          id: "finding-pricing",
          title: "Research pricing",
          url: "https://docs.example.test/pricing",
          sourceId: "source-pricing",
          evidenceId: "evidence-pricing",
        },
      ],
      [
        { evidenceId: "evidence-guide", sourceId: "forged-source-2", title: "Still forged", url: "https://attacker.example/again", retrievedAt },
        { evidenceId: "evidence-pricing", sourceId: "forged-source-3", title: "Also forged", url: "https://attacker.example/pricing", retrievedAt },
      ],
    );
  },
  { maxSearches: 2, maxPagesPerSearch: 1, maxResultsPerSearch: 2 },
);

if (
  mergeCalls.length !== 2
  || merged.status !== "available"
  || merged.findings.length !== 2
  || merged.findings.filter((item) => item.url.includes("/guide")).length !== 1
  || merged.sources?.length !== 2
  || merged.evidence?.length !== 2
  || merged.citations?.length !== 2
) {
  throw new Error("Research response merging or URL deduplication failed.");
}
assertSearchBudget(mergeCalls, { maxSearches: 2, maxPagesPerSearch: 1, maxResultsPerSearch: 2 }, "Merged research");

const evidenceById = new Map((merged.evidence ?? []).map((item) => [item.id, item]));
const sourceById = new Map((merged.sources ?? []).map((item) => [item.id, item]));
for (const citation of merged.citations ?? []) {
  const citedEvidence = evidenceById.get(citation.evidenceId);
  const citedSource = citedEvidence ? sourceById.get(citedEvidence.sourceId) : undefined;
  if (
    !citedEvidence
    || !citedSource
    || citation.sourceId !== citedSource.id
    || citation.title !== citedSource.title
    || citation.url !== citedSource.url
  ) {
    throw new Error("Merged citations did not resolve to their captured evidence and source.");
  }
  if (citation.url.includes("attacker.example")) throw new Error("Citation integrity trusted a provider-supplied URL.");
}

const greetingWorkspace = {
  request: { idea: "Build a campus shuttle telemetry dashboard" },
  memory: { openQuestions: ["Which users should get access first?"] },
  plan: {
    provenance: "deterministic-catalogue",
    stack: [{ toolName: "Next.js", category: "frontend" }, { toolName: "SQLite", category: "database" }],
    roadmap: [{ order: 1, title: "Define scope", detail: "Define the first user journey." }],
  },
  researchFindings: [],
};
const expectedGreetings = new Map([
  ["hi", "Hi! How can I help with your project today?"],
  ["hello!", "Hello! How can I help with your project today?"],
  ["HEY", "Hey! How can I help with your project today?"],
  ["good morning.", "Good morning! How can I help with your project today?"],
]);
for (const [message, expected] of expectedGreetings) {
  const reply = generateDeterministicAssistantReply(greetingWorkspace, message);
  if (reply.source !== "deterministic-fallback" || reply.content !== expected || reply.content.length > 64) {
    throw new Error(`Greeting fallback regression failed for ${message}.`);
  }
  if (reply.content.includes(greetingWorkspace.request.idea) || reply.content.includes(greetingWorkspace.plan.provenance) || reply.content.includes(greetingWorkspace.memory.openQuestions[0])) {
    throw new Error(`Greeting fallback leaked project context for ${message}.`);
  }
}
const planningReply = generateDeterministicAssistantReply(greetingWorkspace, "What should I build first?");
if (planningReply.source !== "deterministic-fallback" || !planningReply.content.includes("Define scope")) {
  throw new Error("Non-greeting planning fallback changed.");
}

const assessment = assessResearchEvidence(
  [
    {
      ...source({ sourceId: "assessment-source-a", title: "Official docs", url: "https://docs.example.test/a" }),
      quality: "official-documentation",
      publicationDate: "2020-01-01T00:00:00.000Z",
      freshness: "stale",
    },
    {
      ...source({ sourceId: "assessment-source-b", title: "Primary docs", url: "https://github.com/example/b" }),
      quality: "primary-source",
      publicationDate: "2025-12-01T00:00:00.000Z",
      freshness: "recent",
    },
  ],
  [
    evidence({ id: "assessment-evidence-a", sourceId: "assessment-source-a", text: "The adapter supports webhooks for this integration." }),
    evidence({ id: "assessment-evidence-b", sourceId: "assessment-source-b", text: "The adapter does not support webhooks for this integration." }),
  ],
  "current-facts",
  { pagesRetrieved: 0, pagesFailed: 1 },
);
if (
  assessment.sourceQuality["official-documentation"] !== 1
  || assessment.evidenceGaps.length < 2
  || assessment.contradictions.length !== 1
) {
  throw new Error("Research quality, evidence-gap, or contradiction assessment failed.");
}

console.log("Research engine smoke checks passed offline.");
