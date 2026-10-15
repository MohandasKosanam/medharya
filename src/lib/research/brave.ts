import type {
  ResearchEvidence,
  ResearchFinding,
  ResearchResponse,
  ResearchSource,
} from "@/types/research";
import {
  createSearchEvidence,
  deduplicateResearchFindings,
  normalizeResearchUrl,
  stableResearchId,
} from "./evidence";
import {
  PageRetrievalError,
  retrievePublicPage,
  type HostResolver,
  type PageFetcher,
} from "./retrieval";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const SEARCH_TIMEOUT_MS = 10_000;
const DEFAULT_PAGE_ATTEMPTS = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function configuredKey(value = process.env.BRAVE_SEARCH_API_KEY) {
  return value?.trim() || null;
}

function resultFinding(value: unknown, retrievedAt: string): ResearchFinding | null {
  if (!isRecord(value)) return null;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const url = typeof value.url === "string" ? value.url.trim() : "";
  const snippet = typeof value.description === "string" ? value.description.trim() : "";
  const canonicalUrl = normalizeResearchUrl(url);
  if (!title || !canonicalUrl || !snippet) return null;

  return {
    id: stableResearchId("finding", canonicalUrl),
    title: title.slice(0, 200),
    url,
    snippet: snippet.slice(0, 600),
    retrievedAt,
    provider: "brave-search",
    verificationStatus: "retrieved-not-yet-verified",
    evidenceKind: "search-snippet",
    pageRetrieved: false,
  };
}

function sourceAndEvidence(finding: ResearchFinding) {
  const result = createSearchEvidence(finding, stableResearchId("source", finding.url));
  if (!result) return null;
  return {
    source: result.source,
    evidence: result.evidence,
    finding: {
      ...finding,
      sourceId: result.source.id,
      evidenceId: result.evidence.id,
    },
  };
}

function retrievalMessage(error: unknown) {
  if (error instanceof PageRetrievalError) {
    if (error.code === "blocked-host") return "Page retrieval was blocked because the result resolved to a private or internal host.";
    if (error.code === "unsupported-content") return "The result was retrieved but is not a readable HTML or text page.";
    if (error.code === "too-large") return "The result was larger than the safe retrieval limit.";
    if (error.code === "timeout") return "The result timed out during safe page retrieval.";
  }
  return "The search result snippet was retained, but its public page could not be retrieved safely.";
}

export interface BraveSearchOptions {
  apiKey?: string;
  fetcher?: PageFetcher;
  resolveHost?: HostResolver;
  retrievePage?: typeof retrievePublicPage;
  now?: () => string;
  pageAttempts?: number;
}

export async function searchWithBrave(query: string, limit = 5, options: BraveSearchOptions = {}): Promise<ResearchResponse> {
  const key = configuredKey(options.apiKey);
  if (!key) {
    return {
      status: "unavailable",
      message: "Live web research is not configured. Add BRAVE_SEARCH_API_KEY on the server to enable it.",
      findings: [],
    };
  }

  const fetcher = options.fetcher ?? fetch;
  const retrievePage = options.retrievePage ?? retrievePublicPage;
  const retrievedAt = options.now?.() ?? new Date().toISOString();
  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", query.trim().slice(0, 300));
  url.searchParams.set("count", String(Math.min(Math.max(limit, 1), 10)));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
      signal: controller.signal,
    });
  } catch (error) {
    return {
      status: "error",
      provider: "brave-search",
      message: error instanceof Error && error.name === "AbortError" ? "The research provider timed out." : "The research provider could not be reached.",
      findings: [],
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return {
      status: "error",
      provider: "brave-search",
      message: response.status === 401 || response.status === 403
        ? "The configured research provider rejected its server-side credential."
        : response.status === 429
          ? "The configured research provider is rate-limited. Try again later."
          : "The configured research provider returned an error.",
      findings: [],
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: "error", provider: "brave-search", message: "The research provider returned invalid data.", findings: [] };
  }

  const web = isRecord(payload) && isRecord(payload.web) ? payload.web : null;
  const results = web && Array.isArray(web.results) ? web.results : [];
  const findings = deduplicateResearchFindings(
    results
      .map((result) => resultFinding(result, retrievedAt))
      .filter((finding): finding is ResearchFinding => Boolean(finding)),
  ).slice(0, Math.min(Math.max(limit, 1), 10));

  const sources: ResearchSource[] = [];
  const evidence: ResearchEvidence[] = [];
  const preparedFindings: ResearchFinding[] = [];
  for (const finding of findings) {
    const prepared = sourceAndEvidence(finding);
    if (!prepared) continue;
    sources.push(prepared.source);
    evidence.push(prepared.evidence);
    preparedFindings.push(prepared.finding);
  }

  const pageAttempts = Math.min(Math.max(options.pageAttempts ?? DEFAULT_PAGE_ATTEMPTS, 0), preparedFindings.length);
  let pagesRetrieved = 0;
  let pagesFailed = 0;
  for (const finding of preparedFindings.slice(0, pageAttempts)) {
    const source = sources.find((candidate) => candidate.id === finding.sourceId);
    const snippetEvidence = evidence.find((candidate) => candidate.id === finding.evidenceId);
    if (!source || !snippetEvidence) continue;
    try {
      const page = await retrievePage(finding.url, {
        fetcher,
        resolveHost: options.resolveHost,
      });
      const pageEvidence: ResearchEvidence = {
        id: stableResearchId("evidence", `${source.id}:page:${page.finalUrl}`),
        sourceId: source.id,
        kind: "retrieved-page",
        text: page.text,
        capturedAt: retrievedAt,
        verificationStatus: "page-retrieved",
        contentType: page.contentType,
        wordCount: page.wordCount,
      };
      source.canonicalUrl = normalizeResearchUrl(page.finalUrl) ?? source.canonicalUrl;
      source.retrievalStatus = "page-retrieved";
      source.contentType = page.contentType;
      finding.verificationStatus = "page-retrieved-not-yet-verified";
      finding.evidenceKind = "retrieved-page";
      finding.pageRetrieved = true;
      evidence.push(pageEvidence);
      finding.evidenceId = pageEvidence.id;
      pagesRetrieved += 1;
    } catch (error) {
      finding.retrievalError = retrievalMessage(error);
      pagesFailed += 1;
    }
  }

  const availablePages = pagesRetrieved ? ` Retrieved ${pagesRetrieved} public page${pagesRetrieved === 1 ? "" : "s"} under the safe content and network limits.` : " No public page was promoted to full-text evidence.";
  return {
    status: "available",
    provider: "brave-search",
    message: preparedFindings.length
      ? `Search results were retrieved as evidence. Snippets and pages remain source-backed, not human-verified.${availablePages}`
      : "The research provider returned no usable public results.",
    findings: preparedFindings,
    sources,
    evidence,
    retrieval: {
      searched: results.length,
      pageAttempts,
      pagesRetrieved,
      pagesFailed,
    },
  };
}
