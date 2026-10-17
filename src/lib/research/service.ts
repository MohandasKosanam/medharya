import { citationsForEvidence, createResearchClaim } from "./evidence";
import { searchWithBrave } from "./brave";
import { runBoundedResearch, type ResearchEngineOptions } from "./engine";
import { sanitizeResearchQuery } from "./intent";
import { summarizeResearchWithModel } from "./summary";
import type { ResearchClaim, ResearchResponse } from "@/types/research";

/** Add deterministic claims and citations without trusting provider URLs. */
export function buildEvidenceSummary(response: ResearchResponse): ResearchResponse {
  const evidence = response.evidence ?? [];
  const sources = response.sources ?? [];
  const claims: ResearchClaim[] = (response.findings ?? [])
    .map((finding) => {
      if (!finding.evidenceId) return null;
      const evidenceRecord = evidence.find((item) => item.id === finding.evidenceId);
      if (!evidenceRecord) return null;
      return createResearchClaim(evidenceRecord.text.slice(0, 520), [evidenceRecord.id], evidence);
    })
    .filter((claim): claim is ResearchClaim => Boolean(claim));
  const citations = citationsForEvidence(claims.flatMap((claim) => claim.evidenceIds), evidence, sources);
  const summary = claims.length
    ? [
        "Source-backed research summary (not human-verified):",
        ...claims.slice(0, 5).map((claim) => `• ${claim.text} [evidence:${claim.evidenceIds[0]}]`),
      ].join("\n")
    : undefined;
  return {
    ...response,
    ...(claims.length ? { claims } : {}),
    ...(citations.length ? { citations } : {}),
    ...(summary ? { summary, summarySource: "deterministic-evidence" as const } : {}),
  };
}

/** Run the same bounded, evidence-first pipeline for buttons and chat. */
export async function runResearchQuery(query: string, options: ResearchEngineOptions = {}): Promise<ResearchResponse> {
  const safeQuery = sanitizeResearchQuery(query);
  const researched = await runBoundedResearch(
    safeQuery,
    (targetQuery, limit, searchOptions) => searchWithBrave(targetQuery, limit, searchOptions),
    options,
  );
  return summarizeResearchWithModel(safeQuery, buildEvidenceSummary(researched));
}
