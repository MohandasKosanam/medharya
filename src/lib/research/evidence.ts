import type {
  ResearchClaim,
  ResearchCitation,
  ResearchAssessment,
  ResearchContradiction,
  ResearchEvidence,
  ResearchFreshness,
  ResearchFinding,
  ResearchSourceQuality,
  ResearchSource,
} from "@/types/research";

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function stableResearchId(prefix: string, value: string) {
  return `${prefix}_${hash(value.trim())}`;
}

/** Normalize a source URL without making a network request. */
export function normalizeResearchUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid$|fbclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function classifyResearchSourceQuality(value: string): ResearchSourceQuality {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    if (hostname.startsWith("docs.") || hostname.startsWith("developer.") || hostname.startsWith("api.")) {
      return "official-documentation";
    }
    if (hostname.endsWith(".gov") || hostname.endsWith(".gov.uk") || hostname.endsWith(".edu")) {
      return "primary-source";
    }
    if (["github.com", "gitlab.com", "npmjs.com", "pypi.org", "arxiv.org"].includes(hostname)) {
      return "primary-source";
    }
    if (["wikipedia.org", "stackoverflow.com", "developer.mozilla.org"].includes(hostname)) {
      return "reputable-secondary";
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}

export function classifyResearchFreshness(publicationDate: string | undefined, retrievedAt: string): ResearchFreshness {
  if (!publicationDate) return "undated";
  const published = Date.parse(publicationDate);
  const retrieved = Date.parse(retrievedAt);
  if (!Number.isFinite(published) || !Number.isFinite(retrieved) || published > retrieved) return "undated";
  const ageDays = (retrieved - published) / 86_400_000;
  if (ageDays <= 180) return "recent";
  if (ageDays <= 730) return "dated";
  return "stale";
}

export function deduplicateResearchFindings(findings: ResearchFinding[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const normalized = normalizeResearchUrl(finding.url);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function createSearchEvidence(
  finding: Pick<ResearchFinding, "title" | "url" | "snippet" | "retrievedAt" | "provider" | "domain" | "publicationDate" | "query">,
  sourceId = stableResearchId("source", finding.url),
): { source: ResearchSource; evidence: ResearchEvidence } | null {
  const canonicalUrl = normalizeResearchUrl(finding.url);
  if (!canonicalUrl || !finding.snippet.trim()) return null;

  const source: ResearchSource = {
    id: sourceId,
    title: finding.title.trim().slice(0, 200),
    url: finding.url.trim(),
    canonicalUrl,
    ...(finding.domain ? { domain: finding.domain } : {}),
    ...(finding.publicationDate ? { publicationDate: finding.publicationDate } : {}),
    ...(finding.query ? { query: finding.query } : {}),
    quality: classifyResearchSourceQuality(canonicalUrl),
    freshness: classifyResearchFreshness(finding.publicationDate, finding.retrievedAt),
    retrievedAt: finding.retrievedAt,
    provider: finding.provider,
    retrievalStatus: "snippet-only",
  };
  const evidence: ResearchEvidence = {
    id: stableResearchId("evidence", `${source.id}:snippet:${finding.snippet}`),
    sourceId: source.id,
    kind: "search-snippet",
    text: finding.snippet.trim().slice(0, 1_200),
    capturedAt: finding.retrievedAt,
    verificationStatus: "snippet-only",
  };
  return { source, evidence };
}

export function mergeResearchEvidence(
  existing: ResearchEvidence[],
  incoming: ResearchEvidence[],
) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].slice(-100);
}

export function mergeResearchSources(existing: ResearchSource[], incoming: ResearchSource[]) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].slice(-100);
}

export function validateEvidenceIds(evidenceIds: string[], evidence: ResearchEvidence[]) {
  const known = new Set(evidence.map((item) => item.id));
  return [...new Set(evidenceIds.filter((id) => known.has(id)))];
}

export function citationsForEvidence(
  evidenceIds: string[],
  evidence: ResearchEvidence[],
  sources: ResearchSource[],
): ResearchCitation[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return validateEvidenceIds(evidenceIds, evidence)
    .map((evidenceId) => {
      const record = evidence.find((item) => item.id === evidenceId);
      const source = record ? sourceById.get(record.sourceId) : undefined;
      if (!record || !source || source.retrievalStatus === "retrieval-failed") return null;
      return {
        evidenceId,
        sourceId: source.id,
        title: source.title,
        url: source.url,
        retrievedAt: source.retrievedAt,
      } satisfies ResearchCitation;
    })
    .filter((citation): citation is ResearchCitation => Boolean(citation));
}

export function createResearchClaim(
  text: string,
  evidenceIds: string[],
  evidence: ResearchEvidence[],
  provenance: ResearchClaim["provenance"] = "deterministic-evidence",
): ResearchClaim {
  const validEvidenceIds = validateEvidenceIds(evidenceIds, evidence);
  const hasRetrievalFailure = validEvidenceIds.some((id) => evidence.find((item) => item.id === id)?.verificationStatus === "retrieval-failed");
  const hasPageEvidence = validEvidenceIds.some((id) => evidence.find((item) => item.id === id)?.kind === "retrieved-page");
  return {
    id: stableResearchId("claim", `${text}:${validEvidenceIds.join(",")}`),
    text: text.trim().slice(0, 600),
    evidenceIds: validEvidenceIds,
    supportStatus: hasRetrievalFailure || !validEvidenceIds.length
      ? "unverified"
      : hasPageEvidence
        ? "supported"
        : "unverified",
    provenance,
    createdAt: new Date().toISOString(),
  };
}

const CONTRADICTION_STOP_WORDS = new Set([
  "about", "after", "also", "because", "been", "being", "does", "from", "have", "into", "more", "only", "that", "their", "there", "these", "they", "this", "those", "with",
]);

function assertionPolarity(text: string) {
  const negative = /\b(?:does not|doesn't|do not|don't|cannot|can't|not supported|unsupported|incompatible|unavailable|deprecated|no longer|fails?)\b/i.test(text);
  const positive = /\b(?:supports?|compatible|available|works?|allows?|enabled|recommended|can)\b/i.test(text);
  return negative ? -1 : positive ? 1 : 0;
}

function topicTokens(text: string) {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !CONTRADICTION_STOP_WORDS.has(token)),
  );
}

function detectContradictions(evidence: ResearchEvidence[]): ResearchContradiction[] {
  const contradictions: ResearchContradiction[] = [];
  for (let leftIndex = 0; leftIndex < evidence.length; leftIndex += 1) {
    const left = evidence[leftIndex];
    const leftPolarity = assertionPolarity(left.text);
    if (!leftPolarity) continue;
    const leftTokens = topicTokens(left.text);
    for (let rightIndex = leftIndex + 1; rightIndex < evidence.length; rightIndex += 1) {
      const right = evidence[rightIndex];
      if (left.sourceId === right.sourceId) continue;
      const rightPolarity = assertionPolarity(right.text);
      if (!rightPolarity || leftPolarity === rightPolarity) continue;
      const sharedTokens = [...leftTokens].filter((token) => topicTokens(right.text).has(token));
      if (sharedTokens.length < 1) continue;
      const evidenceIds = [left.id, right.id];
      contradictions.push({
        id: stableResearchId("contradiction", evidenceIds.join(":")),
        summary: `Potentially conflicting statements about ${sharedTokens.slice(0, 3).join(", ")}. Review both cited records before deciding.`,
        evidenceIds,
      });
    }
  }
  return contradictions.slice(0, 12);
}

export function assessResearchEvidence(
  sources: ResearchSource[],
  evidence: ResearchEvidence[],
  intent?: "current-facts" | "documentation" | "comparison" | "troubleshooting" | "general",
  retrieval?: { pagesRetrieved: number; pagesFailed: number },
): ResearchAssessment {
  const sourceQuality: ResearchAssessment["sourceQuality"] = {};
  for (const source of sources) {
    const quality = source.quality ?? "unknown";
    sourceQuality[quality] = (sourceQuality[quality] ?? 0) + 1;
  }
  const evidenceGaps: string[] = [];
  if (!evidence.length) evidenceGaps.push("No evidence records were collected.");
  if (evidence.length && !evidence.some((record) => record.kind === "retrieved-page")) {
    evidenceGaps.push("No public page was retrieved; the available evidence is limited to search snippets.");
  }
  if (sources.some((source) => !source.quality || source.quality === "unknown")) {
    evidenceGaps.push("Some sources could not be classified by domain, so source quality remains uncertain.");
  }
  if (sources.some((source) => !source.publicationDate || source.freshness === "undated")) {
    evidenceGaps.push("Some sources have no reliable publication date; freshness could not be assessed.");
  }
  if (sources.some((source) => source.freshness === "stale")) {
    evidenceGaps.push("At least one source is older than two years relative to retrieval; current claims need extra verification.");
  }
  if ((retrieval?.pagesFailed ?? 0) > 0) {
    evidenceGaps.push(`${retrieval?.pagesFailed} public page retrieval attempt${retrieval?.pagesFailed === 1 ? "" : "s"} failed.`);
  }
  if (intent === "current-facts" && !sources.some((source) => source.freshness === "recent")) {
    evidenceGaps.push("This current-facts question has no source classified as recent.");
  }
  return {
    sourceQuality,
    evidenceGaps: [...new Set(evidenceGaps)],
    contradictions: detectContradictions(evidence),
  };
}
