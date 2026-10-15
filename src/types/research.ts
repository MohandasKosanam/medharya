export type ResearchProvider = "brave-search";

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
}
