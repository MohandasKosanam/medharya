import type { ProjectRequest } from "@/types/project";

import { TECHNOLOGY_CATALOGUE, TECHNOLOGY_CATALOGUE_BY_ID } from "./data";
import type { CatalogueCategory } from "./types";

export { TECHNOLOGY_CATALOGUE, TECHNOLOGY_CATALOGUE_BY_ID } from "./data";
export type { CatalogueCategory, CatalogueTool, PricingModel } from "./types";

export function getCatalogueTool(toolId: string) {
  return TECHNOLOGY_CATALOGUE_BY_ID.get(toolId) ?? null;
}

export function searchTechnologyCatalogue(query: string, limit = 12) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return TECHNOLOGY_CATALOGUE.slice(0, limit);

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  return TECHNOLOGY_CATALOGUE.filter((tool) => {
    const haystack = [
      tool.id,
      tool.name,
      tool.category,
      tool.description,
      tool.intendedUse,
      ...tool.tags,
    ]
      .join(" ")
      .toLowerCase();

    return terms.every((term) => haystack.includes(term));
  }).slice(0, limit);
}

export function listCatalogueByCategory(category: CatalogueCategory) {
  return TECHNOLOGY_CATALOGUE.filter((tool) => tool.category === category);
}

export function getRelevantCatalogueEntries(request: ProjectRequest, limit = 16) {
  const query = [
    request.category,
    request.idea,
    request.additionalRequirements,
    ...request.preferredTechnologies,
  ]
    .join(" ")
    .toLowerCase();

  const scored = TECHNOLOGY_CATALOGUE.map((tool) => {
    let score = 0;
    if (tool.suitableProjectTypes.includes(request.category)) score += 4;
    for (const preference of request.preferredTechnologies) {
      if (
        tool.name.toLowerCase() === preference.toLowerCase() ||
        tool.tags.some((tag) => tag.toLowerCase() === preference.toLowerCase())
      ) {
        score += 8;
      }
    }
    for (const tag of tool.tags) {
      if (query.includes(tag.toLowerCase())) score += 2;
    }
    return { tool, score };
  });

  return scored
    .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
    .slice(0, limit)
    .map(({ tool }) => tool);
}
