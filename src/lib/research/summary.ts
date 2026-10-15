import { getConfiguredModelProvider } from "@/lib/providers/openai-compatible";
import type { ModelPrompt } from "@/lib/providers/types";
import {
  citationsForEvidence,
  createResearchClaim,
  validateEvidenceIds,
} from "./evidence";
import type { ResearchClaim, ResearchResponse } from "@/types/research";

function evidenceIds(text: string) {
  return [...text.matchAll(/\[evidence:([A-Za-z0-9_-]+)\]/g)].map((match) => match[1]);
}

function withoutMarkers(text: string) {
  return text.replace(/\[evidence:[A-Za-z0-9_-]+\]/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function materialLines(text: string) {
  return text
    .split(/\r?\n+/)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length >= 24 && !/^summary:?$/i.test(line));
}

export async function summarizeResearchWithModel(query: string, response: ResearchResponse): Promise<ResearchResponse> {
  const provider = getConfiguredModelProvider();
  const evidence = response.evidence ?? [];
  const sources = response.sources ?? [];
  if (!provider || !evidence.length) return response;

  const evidenceContext = evidence.slice(-12).map((record) =>
    `[evidence:${record.id}] (${record.verificationStatus}) ${record.text.slice(0, 1_800)}`,
  ).join("\n");
  const prompt: ModelPrompt = {
    system: [
      "You are a research synthesis assistant.",
      "Use only the supplied evidence text. Do not add current prices, compatibility claims, URLs, or facts that are not in the evidence.",
      "Write up to five concise bullet points. Every material bullet must end with one or more exact [evidence:ID] markers from the supplied records.",
      "If the evidence is insufficient, say that it is insufficient and cite the closest evidence instead of guessing.",
      "A source-backed statement is not human verification; do not call anything verified.",
    ].join(" "),
    context: `Research question: ${query}\nEvidence records:\n${evidenceContext}`,
    recentMessages: [],
    userMessage: "Synthesize the evidence conservatively.",
  };
  const result = await provider.complete(prompt);
  if (result.status !== "available" || !result.text) return response;

  const ids = evidenceIds(result.text);
  const validIds = validateEvidenceIds(ids, evidence);
  const lines = materialLines(result.text);
  const everyMaterialLineCited = lines.length > 0 && lines.every((line) => evidenceIds(line).some((id) => validIds.includes(id)));
  if (!everyMaterialLineCited || !validIds.length || ids.some((id) => !validIds.includes(id))) return response;

  const claims: ResearchClaim[] = lines
    .map((line) => createResearchClaim(withoutMarkers(line), evidenceIds(line), evidence, "model-assisted"));
  const citations = citationsForEvidence(validIds, evidence, sources);
  return {
    ...response,
    claims: [...(response.claims ?? []), ...claims].slice(-100),
    citations,
    summary: withoutMarkers(result.text),
    summarySource: "model-assisted",
  };
}
