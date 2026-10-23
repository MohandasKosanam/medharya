export type ResearchProvider = "brave-search" | "tinyfish-search";

export type ResearchSourceQuality = "official-documentation" | "primary-source" | "reputable-secondary" | "unknown";
export type ResearchFreshness = "recent" | "dated" | "stale" | "undated";

export type ResearchIntent =
  | "current-facts"
  | "documentation"
  | "comparison"
  | "troubleshooting"
  | "general";

export interface ResearchIntentResult {
  shouldResearch: boolean;
  intent: ResearchIntent;
  reason: string;
  queries: string[];
}

export type ResearchEvidenceKind = "search-snippet" | "retrieved-page";

export type ResearchEvidenceStatus =
  | "snippet-only"
  | "page-retrieved"
  | "retrieval-failed";

export type ResearchVerificationStatus =
  | "retrieved-not-yet-verified"
  | "page-retrieved-not-yet-verified"
  | "retrieval-failed";

/** A URL returned by the configured search provider. */
export interface ResearchSource {
  id: string;
  title: string;
  url: string;
  canonicalUrl: string;
  domain?: string;
  publicationDate?: string;
  query?: string;
  quality?: ResearchSourceQuality;
  freshness?: ResearchFreshness;
  retrievedAt: string;
  provider: ResearchProvider;
  retrievalStatus: ResearchEvidenceStatus;
  contentType?: string;
  retrievalError?: string;
}

/** A bounded, server-captured piece of evidence tied to one source. */
export interface ResearchEvidence {
  id: string;
  sourceId: string;
  kind: ResearchEvidenceKind;
  text: string;
  capturedAt: string;
  verificationStatus: ResearchEvidenceStatus;
  contentType?: string;
  wordCount?: number;
  headings?: string[];
}

export type ResearchClaimSupport = "supported" | "unverified" | "contradicted";

/** A claim may only be presented as supported when its evidenceIds resolve. */
export interface ResearchClaim {
  id: string;
  text: string;
  evidenceIds: string[];
  supportStatus: ResearchClaimSupport;
  provenance: "deterministic-evidence" | "model-assisted";
  createdAt: string;
}

/** Citation payloads are derived from evidence, never from model-provided URLs. */
export interface ResearchCitation {
  evidenceId: string;
  sourceId: string;
  title: string;
  url: string;
  retrievedAt: string;
}

export interface ResearchFinding {
  id: string;
  title: string;
  url: string;
  snippet: string;
  retrievedAt: string;
  provider: ResearchProvider;
  verificationStatus: ResearchVerificationStatus;
  domain?: string;
  publicationDate?: string;
  query?: string;
  sourceId?: string;
  evidenceId?: string;
  evidenceKind?: ResearchEvidenceKind;
  pageRetrieved?: boolean;
  retrievalError?: string;
}

export interface ResearchRetrievalStats {
  searched: number;
  pageAttempts: number;
  pagesRetrieved: number;
  pagesFailed: number;
}

export interface ResearchContradiction {
  id: string;
  summary: string;
  evidenceIds: string[];
}

export interface ResearchAssessment {
  sourceQuality: Partial<Record<ResearchSourceQuality, number>>;
  evidenceGaps: string[];
  contradictions: ResearchContradiction[];
}

export interface ResearchResponse {
  status: "available" | "unavailable" | "error";
  provider?: ResearchProvider;
  message: string;
  findings: ResearchFinding[];
  sources?: ResearchSource[];
  evidence?: ResearchEvidence[];
  claims?: ResearchClaim[];
  citations?: ResearchCitation[];
  summary?: string;
  summarySource?: "deterministic-evidence" | "model-assisted";
  retrieval?: ResearchRetrievalStats;
  intent?: ResearchIntentResult;
  assessment?: ResearchAssessment;
}
