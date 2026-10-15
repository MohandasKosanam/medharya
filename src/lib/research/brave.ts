import type { ResearchFinding, ResearchResponse } from "@/types/research";

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function configuredKey() {
  return process.env.BRAVE_SEARCH_API_KEY?.trim() || null;
}

function resultFinding(value: unknown, index: number, retrievedAt: string): ResearchFinding | null {
  if (!isRecord(value)) return null;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const url = typeof value.url === "string" ? value.url.trim() : "";
  const snippet = typeof value.description === "string" ? value.description.trim() : "";
  if (!title || !url || !/^https?:\/\//i.test(url)) return null;

  return {
    id: `brave_${Date.now().toString(36)}_${index}`,
    title: title.slice(0, 200),
    url,
    snippet: snippet.slice(0, 600),
    retrievedAt,
    provider: "brave-search",
    verificationStatus: "retrieved-not-yet-verified",
  };
}

export async function searchWithBrave(query: string, limit = 5): Promise<ResearchResponse> {
  const key = configuredKey();
  if (!key) {
    return {
      status: "unavailable",
      message: "Live web research is not configured. Add BRAVE_SEARCH_API_KEY on the server to enable it.",
      findings: [],
    };
  }

  const retrievedAt = new Date().toISOString();
  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", query.trim().slice(0, 300));
  url.searchParams.set("count", String(Math.min(Math.max(limit, 1), 10)));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        status: "error",
        provider: "brave-search",
        message: response.status === 429
          ? "The configured research provider is rate-limited. Try again later."
          : "The configured research provider returned an error.",
        findings: [],
      };
    }

    const payload: unknown = await response.json();
    const web = isRecord(payload) && isRecord(payload.web) ? payload.web : null;
    const results = web && Array.isArray(web.results) ? web.results : [];
    const findings = results
      .map((result, index) => resultFinding(result, index, retrievedAt))
      .filter((finding): finding is ResearchFinding => Boolean(finding));

    return {
      status: "available",
      provider: "brave-search",
      message: findings.length
        ? "Search results were retrieved. They are attached as evidence but still require human verification."
        : "The research provider returned no usable public results.",
      findings,
    };
  } catch (error) {
    return {
      status: "error",
      provider: "brave-search",
      message: error instanceof Error && error.name === "AbortError"
        ? "The research provider timed out."
        : "The research provider could not be reached.",
      findings: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}
