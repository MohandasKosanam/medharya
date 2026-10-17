import { assessResearchEvidence, citationsForEvidence, deduplicateResearchFindings, mergeResearchEvidence, mergeResearchSources } from "./evidence";
import { detectResearchIntent, type ResearchIntentResult } from "./intent";
import type { ResearchResponse } from "@/types/research";

export const RESEARCH_LIMITS = {
  maxSearches: 3,
  maxPagesPerSearch: 3,
  maxResultsPerSearch: 6,
  maxTotalEvidence: 36,
} as const;

export type ResearchSearch = (
  query: string,
  limit: number,
  options?: { pageAttempts?: number },
) => Promise<ResearchResponse>;

export interface ResearchEngineResult extends ResearchResponse {
  intent: ResearchIntentResult;
}

export interface ResearchEngineOptions {
  maxSearches?: number;
  maxPagesPerSearch?: number;
  maxResultsPerSearch?: number;
  maxTotalEvidence?: number;
}

function mergeResponses(responses: ResearchResponse[], intent: ResearchIntentResult, maxTotalEvidence: number): ResearchEngineResult {
  const available = responses.filter((response) => response.status === "available");
  const firstFailure = responses.find((response) => response.status === "error" || response.status === "unavailable");
  if (!available.length) {
    return {
      ...(firstFailure ?? { status: "unavailable", message: "Live web research is unavailable.", findings: [] }),
      intent,
    };
  }

  const findings = deduplicateResearchFindings(available.flatMap((response) => response.findings)).slice(0, maxTotalEvidence);
  const sources = mergeResearchSources([], available.flatMap((response) => response.sources ?? []));
  const evidence = mergeResearchEvidence([], available.flatMap((response) => response.evidence ?? [])).slice(-maxTotalEvidence);
  const claims = available.flatMap((response) => response.claims ?? []).slice(-100);
  const citations = citationsForEvidence(
    available.flatMap((response) => (response.citations ?? []).map((citation) => citation.evidenceId)),
    evidence,
    sources,
  );
  const retrieval = available.reduce(
    (stats, response) => ({
      searched: stats.searched + (response.retrieval?.searched ?? 0),
      pageAttempts: stats.pageAttempts + (response.retrieval?.pageAttempts ?? 0),
      pagesRetrieved: stats.pagesRetrieved + (response.retrieval?.pagesRetrieved ?? 0),
      pagesFailed: stats.pagesFailed + (response.retrieval?.pagesFailed ?? 0),
    }),
    { searched: 0, pageAttempts: 0, pagesRetrieved: 0, pagesFailed: 0 },
  );
  const assessment = assessResearchEvidence(sources, evidence, intent.intent, retrieval);

  return {
    status: "available",
    provider: available.find((response) => response.provider)?.provider,
    message: `Live research used ${available.length} bounded search step${available.length === 1 ? "" : "s"}. Results are source-backed and not human verification.${firstFailure ? " One or more follow-up searches were unavailable." : ""}`,
    findings,
    ...(sources.length ? { sources } : {}),
    ...(evidence.length ? { evidence } : {}),
    ...(claims.length ? { claims } : {}),
    ...(citations.length ? { citations } : {}),
    assessment,
    retrieval,
    intent,
  };
}

/** Execute a bounded, sequential research plan so provider and page budgets are explicit. */
export async function runBoundedResearch(
  query: string,
  search: ResearchSearch,
  options: ResearchEngineOptions = {},
): Promise<ResearchEngineResult> {
  const intent = detectResearchIntent(query);
  const maxSearches = Math.min(Math.max(options.maxSearches ?? RESEARCH_LIMITS.maxSearches, 1), RESEARCH_LIMITS.maxSearches);
  const maxPagesPerSearch = Math.min(Math.max(options.maxPagesPerSearch ?? RESEARCH_LIMITS.maxPagesPerSearch, 0), RESEARCH_LIMITS.maxPagesPerSearch);
  const maxResultsPerSearch = Math.min(Math.max(options.maxResultsPerSearch ?? RESEARCH_LIMITS.maxResultsPerSearch, 1), RESEARCH_LIMITS.maxResultsPerSearch);
  const maxTotalEvidence = Math.min(Math.max(options.maxTotalEvidence ?? RESEARCH_LIMITS.maxTotalEvidence, 1), RESEARCH_LIMITS.maxTotalEvidence);
  const queries = [...new Set(intent.queries)].slice(0, maxSearches);
  const responses: ResearchResponse[] = [];

  for (const targetQuery of queries) {
    responses.push(await search(targetQuery, maxResultsPerSearch, { pageAttempts: maxPagesPerSearch }));
    if (responses.at(-1)?.status === "unavailable" && responses.length === 1) break;
  }

  return mergeResponses(responses, intent, maxTotalEvidence);
}
