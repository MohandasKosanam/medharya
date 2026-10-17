import type { ResearchIntentResult } from "@/types/research";

export type { ResearchIntent, ResearchIntentResult } from "@/types/research";

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

const SENSITIVE_QUERY_PATTERNS = [
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret)\s*(?:[:=]\s*|\s+)[^\s,;]+/gi,
  /\bbearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:sk|pk)-(?:live|test)-[A-Za-z0-9_-]+/gi,
  /\bsk-[A-Za-z0-9_-]{12,}/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{10,}/gi,
  /\bAKIA[0-9A-Z]{16}\b/gi,
];

export function sanitizeResearchQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(SENSITIVE_QUERY_PATTERNS[0], "[redacted]")
    .replace(SENSITIVE_QUERY_PATTERNS[1], "[redacted]")
    .replace(SENSITIVE_QUERY_PATTERNS[2], "[redacted]")
    .replace(SENSITIVE_QUERY_PATTERNS[3], "[redacted]")
    .replace(SENSITIVE_QUERY_PATTERNS[4], "[redacted]")
    .replace(SENSITIVE_QUERY_PATTERNS[5], "[redacted]")
    .slice(0, 300);
}

const cleanQuery = sanitizeResearchQuery;

/**
 * Keep research explicit for ambiguous prompts while recognizing requests
 * where current external evidence materially improves the answer.
 */
export function detectResearchIntent(value: string): ResearchIntentResult {
  const query = sanitizeResearchQuery(value);
  const normalized = query.toLocaleLowerCase();
  if (!query) {
    return { shouldResearch: false, intent: "general", reason: "No research question was supplied.", queries: [] };
  }

  if (includesAny(normalized, ["debug", "error", "stack trace", "not working", "fails", "failure", "bug"])) {
    return {
      shouldResearch: true,
      intent: "troubleshooting",
      reason: "Troubleshooting often depends on current release notes and official issue documentation.",
      queries: [query, `${query} official documentation`, `${query} issue release notes`].map(cleanQuery),
    };
  }
  if (includesAny(normalized, ["compare", "comparison", "versus", " vs ", "alternative", "which is better", "pros and cons"])) {
    return {
      shouldResearch: true,
      intent: "comparison",
      reason: "The question asks for alternatives or trade-offs that need source-backed comparison.",
      queries: [query, `${query} official documentation`, `${query} limitations pricing`].map(cleanQuery),
    };
  }
  if (includesAny(normalized, ["latest", "current", "today", "recent", "now", "202", "pricing", "price", "availability"])) {
    return {
      shouldResearch: true,
      intent: "current-facts",
      reason: "The question asks for information that can change over time.",
      queries: [query, `${query} official source`].map(cleanQuery),
    };
  }
  if (includesAny(normalized, ["official docs", "documentation", "api reference", "how do i use", "install", "configure"])) {
    return {
      shouldResearch: true,
      intent: "documentation",
      reason: "Official documentation is the appropriate primary source for this question.",
      queries: [query, `${query} official documentation`].map(cleanQuery),
    };
  }

  return {
    shouldResearch: false,
    intent: "general",
    reason: "The question is not clearly current, source-dependent, or research-specific.",
    queries: [query],
  };
}
