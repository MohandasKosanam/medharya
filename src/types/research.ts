export interface ResearchFinding {
  id: string;
  title: string;
  url: string;
  snippet: string;
  retrievedAt: string;
  provider: "brave-search";
  verificationStatus: "retrieved-not-yet-verified";
}

export interface ResearchResponse {
  status: "available" | "unavailable" | "error";
  provider?: "brave-search";
  message: string;
  findings: ResearchFinding[];
}
