import type {
  ResearchEvidence,
  ResearchFinding,
  ResearchResponse,
  ResearchSource,
} from "@/types/research";
import {
  classifyResearchFreshness,
  createSearchEvidence,
  deduplicateResearchFindings,
  normalizeResearchUrl,
  stableResearchId,
} from "./evidence";

const TINYFISH_SEARCH_ENDPOINT = "https://api.search.tinyfish.ai";
const TINYFISH_FETCH_ENDPOINT = "https://api.fetch.tinyfish.ai";
const SEARCH_TIMEOUT_MS = 12_000;
const FETCH_TIMEOUT_MS = 35_000;
const DEFAULT_SEARCH_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 150;
const DEFAULT_PAGE_ATTEMPTS = 3;

type TinyFishRequest = (input: string, init?: RequestInit) => Promise<Response>;

export interface TinyFishSearchOptions {
  apiKey?: string;
  fetcher?: TinyFishRequest;
  now?: () => string;
  pageAttempts?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function configuredKey(value = process.env.TINYFISH_API_KEY) {
  return value?.trim() || null;
}

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function dateValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function resultFinding(value: unknown, retrievedAt: string, query: string): ResearchFinding | null {
  if (!isRecord(value)) return null;
  const title = textValue(value.title, 200);
  const url = textValue(value.url, 2_000);
  const snippet = textValue(value.snippet ?? value.description, 800);
  const canonicalUrl = normalizeResearchUrl(url);
  if (!title || !canonicalUrl || !snippet) return null;

  let domain: string | undefined;
  try {
    domain = new URL(canonicalUrl).hostname;
  } catch {
    domain = undefined;
  }

  const publicationDate = dateValue(
    value.published_at
      ?? value.publishedAt
      ?? value.publication_date
      ?? value.publicationDate,
  );

  return {
    id: stableResearchId("finding", canonicalUrl),
    title,
    url,
    snippet,
    retrievedAt,
    provider: "tinyfish-search",
    verificationStatus: "retrieved-not-yet-verified",
    evidenceKind: "search-snippet",
    pageRetrieved: false,
    ...(domain ? { domain } : {}),
    ...(publicationDate ? { publicationDate } : {}),
    query,
  };
}

function sourceAndEvidence(finding: ResearchFinding) {
  const result = createSearchEvidence(finding, stableResearchId("source", finding.url));
  if (!result) return null;
  return {
    source: { ...result.source, provider: "tinyfish-search" as const },
    evidence: result.evidence,
    finding: { ...finding, sourceId: result.source.id, evidenceId: result.evidence.id },
  };
}

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function providerMessage(status: number, action: "search" | "fetch") {
  if (status === 401 || status === 403) return `TinyFish ${action} rejected its server-side credential.`;
  if (status === 429) return `TinyFish ${action} is rate-limited. Try again later.`;
  return `TinyFish ${action} returned an error.`;
}

async function requestJson(
  endpoint: string,
  init: RequestInit,
  fetcher: TinyFishRequest,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(endpoint, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPageEvidence(
  key: string,
  findings: ResearchFinding[],
  sources: ResearchSource[],
  evidence: ResearchEvidence[],
  retrievedAt: string,
  query: string,
  fetcher: TinyFishRequest,
  pageAttempts: number,
) {
  const targets = findings.slice(0, pageAttempts);
  if (!targets.length) return { pagesRetrieved: 0, pagesFailed: 0 };

  let response: Response;
  try {
    response = await requestJson(
      TINYFISH_FETCH_ENDPOINT,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-Key": key,
        },
        body: JSON.stringify({
          urls: targets.map((finding) => finding.url),
          format: "markdown",
          ttl: 0,
          purpose: `Extract current evidence relevant to: ${query.slice(0, 500)}`,
        }),
      },
      fetcher,
      FETCH_TIMEOUT_MS,
    );
  } catch {
    targets.forEach((finding) => {
      finding.retrievalError = "TinyFish page extraction could not be reached or timed out.";
    });
    return { pagesRetrieved: 0, pagesFailed: targets.length };
  }

  if (!response.ok) {
    const message = providerMessage(response.status, "fetch");
    targets.forEach((finding) => { finding.retrievalError = message; });
    return { pagesRetrieved: 0, pagesFailed: targets.length };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    targets.forEach((finding) => { finding.retrievalError = "TinyFish returned invalid page extraction data."; });
    return { pagesRetrieved: 0, pagesFailed: targets.length };
  }

  const results = isRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
  const errors = isRecord(payload) && Array.isArray(payload.errors) ? payload.errors : [];
  let pagesRetrieved = 0;
  let pagesFailed = 0;

  for (const finding of targets) {
    const normalizedFindingUrl = normalizeResearchUrl(finding.url);
    const result = results.find((item) => {
      if (!isRecord(item)) return false;
      return normalizeResearchUrl(textValue(item.url ?? item.final_url, 2_000)) === normalizedFindingUrl;
    });
    const extractionError = errors.find((item) => isRecord(item) && normalizeResearchUrl(textValue(item.url, 2_000)) === normalizedFindingUrl);
    if (!result || !isRecord(result) || !textValue(result.text, 18_000)) {
      finding.retrievalError = extractionError && isRecord(extractionError) && textValue(extractionError.error, 400)
        ? textValue(extractionError.error, 400)
        : "TinyFish did not return readable page content for this result.";
      pagesFailed += 1;
      continue;
    }

    const source = sources.find((candidate) => candidate.id === finding.sourceId);
    const snippetEvidence = evidence.find((candidate) => candidate.id === finding.evidenceId);
    if (!source || !snippetEvidence) {
      finding.retrievalError = "The page result could not be linked to its captured source record.";
      pagesFailed += 1;
      continue;
    }

    const finalUrl = normalizeResearchUrl(textValue(result.final_url ?? result.url, 2_000)) ?? source.canonicalUrl;
    const pageText = textValue(result.text, 18_000);
    const pageEvidence: ResearchEvidence = {
      id: stableResearchId("evidence", `${source.id}:page:${finalUrl}`),
      sourceId: source.id,
      kind: "retrieved-page",
      text: pageText,
      capturedAt: retrievedAt,
      verificationStatus: "page-retrieved",
      contentType: textValue(result.format, 80) || undefined,
      wordCount: pageText.split(/\s+/).filter(Boolean).length,
    };
    const publicationDate = dateValue(result.published_at ?? result.publishedAt ?? result.date);
    source.canonicalUrl = finalUrl;
    source.retrievalStatus = "page-retrieved";
    source.contentType = pageEvidence.contentType;
    if (publicationDate) {
      source.publicationDate = publicationDate;
      source.freshness = classifyResearchFreshness(publicationDate, retrievedAt);
      finding.publicationDate = publicationDate;
    }
    finding.verificationStatus = "page-retrieved-not-yet-verified";
    finding.evidenceKind = "retrieved-page";
    finding.pageRetrieved = true;
    finding.evidenceId = pageEvidence.id;
    evidence.push(pageEvidence);
    pagesRetrieved += 1;
  }

  return { pagesRetrieved, pagesFailed };
}

export async function searchWithTinyFish(
  query: string,
  limit = 5,
  options: TinyFishSearchOptions = {},
): Promise<ResearchResponse> {
  const key = process.env.MEDHARYA_DISABLE_EXTERNAL_PROVIDERS === "1" && options.apiKey === undefined
    ? null
    : configuredKey(options.apiKey);
  if (!key) {
    return {
      status: "unavailable",
      provider: "tinyfish-search",
      message: "Live web research is not configured. Add TINYFISH_API_KEY on the server to enable TinyFish.",
      findings: [],
    };
  }

  const fetcher = options.fetcher ?? fetch;
  const retrievedAt = options.now?.() ?? new Date().toISOString();
  const boundedLimit = Math.min(Math.max(limit, 1), 10);
  const searchUrl = new URL(TINYFISH_SEARCH_ENDPOINT);
  searchUrl.searchParams.set("query", query.trim().slice(0, 300));
  searchUrl.searchParams.set("domain_type", "web");
  searchUrl.searchParams.set("purpose", `Find current sources relevant to: ${query.trim().slice(0, 500)}`);

  const maxAttempts = Math.min(Math.max(options.maxAttempts ?? DEFAULT_SEARCH_ATTEMPTS, 1), 3);
  const retryDelayMs = Math.min(Math.max(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, 0), 2_000);
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      response = await requestJson(searchUrl.toString(), {
        headers: { Accept: "application/json", "X-API-Key": key },
      }, fetcher, SEARCH_TIMEOUT_MS);
      if (!retryableStatus(response.status) || attempt === maxAttempts - 1) break;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) break;
    }
    await wait(retryDelayMs * (attempt + 1));
  }

  if (!response) {
    return {
      status: "error",
      provider: "tinyfish-search",
      message: lastError instanceof Error && lastError.name === "AbortError" ? "TinyFish search timed out." : "TinyFish search could not be reached.",
      findings: [],
    };
  }
  if (!response.ok) {
    return { status: "error", provider: "tinyfish-search", message: providerMessage(response.status, "search"), findings: [] };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: "error", provider: "tinyfish-search", message: "TinyFish returned invalid search data.", findings: [] };
  }

  const rawResults = isRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
  const findings = deduplicateResearchFindings(
    rawResults.map((result) => resultFinding(result, retrievedAt, query)).filter((finding): finding is ResearchFinding => Boolean(finding)),
  ).slice(0, boundedLimit);
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
  const pages = await fetchPageEvidence(key, preparedFindings, sources, evidence, retrievedAt, query, fetcher, pageAttempts);
  const pageMessage = pages.pagesRetrieved
    ? ` Retrieved ${pages.pagesRetrieved} public page${pages.pagesRetrieved === 1 ? "" : "s"} through TinyFish Fetch.`
    : " No public page was promoted to full-text evidence.";

  return {
    status: "available",
    provider: "tinyfish-search",
    message: preparedFindings.length
      ? `TinyFish Search returned source-backed results. They are not human verification.${pageMessage}`
      : "TinyFish returned no usable public results.",
    findings: preparedFindings,
    sources,
    evidence,
    retrieval: {
      searched: rawResults.length,
      pageAttempts,
      pagesRetrieved: pages.pagesRetrieved,
      pagesFailed: pages.pagesFailed,
    },
  };
}
