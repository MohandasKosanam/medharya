import type {
  ResearchClaim,
  ResearchCitation,
  ResearchEvidence,
  ResearchFinding,
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
  finding: Pick<ResearchFinding, "title" | "url" | "snippet" | "retrievedAt" | "provider">,
  sourceId = stableResearchId("source", finding.url),
): { source: ResearchSource; evidence: ResearchEvidence } | null {
  const canonicalUrl = normalizeResearchUrl(finding.url);
  if (!canonicalUrl || !finding.snippet.trim()) return null;

  const source: ResearchSource = {
    id: sourceId,
    title: finding.title.trim().slice(0, 200),
    url: finding.url.trim(),
    canonicalUrl,
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
