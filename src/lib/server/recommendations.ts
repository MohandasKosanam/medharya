import { TECHNOLOGY_CATALOGUE } from "@/catalog/data";
import { applyModelPlanSignals, generateSolutionPlan, type ModelPlanSignals } from "@/lib/recommendations";
import { getConfiguredModelProvider, selectedModelProviderStatus } from "@/lib/providers/openai-compatible";
import type { ModelProviderResult, ModelProviderStatus } from "@/lib/providers/types";
import type { ProjectRequest } from "@/types/project";
import type { SolutionPlan } from "@/types/solution";

export interface ServerPlanResult {
  plan: SolutionPlan;
  providerStatus: ModelProviderStatus;
  provider?: string;
  model?: string;
  usedFallback: boolean;
  reason?: string;
}

function bounded(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function stringList(value: unknown, maximum: number, itemLength: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, itemLength))
    .filter(Boolean))].slice(0, maximum);
}

function parseModelSignals(text: string): ModelPlanSignals | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate || !candidate.trim()) return null;

  try {
    const parsed: unknown = JSON.parse(candidate);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const selectedToolIds = stringList(record.selectedToolIds ?? record.toolIds, 12, 100);
    if (!selectedToolIds.length) return null;
    return {
      summary: bounded(record.summary, 700) || undefined,
      selectedToolIds,
      alternativeToolIds: stringList(record.alternativeToolIds ?? record.alternatives, 6, 100),
      openQuestions: stringList(record.openQuestions, 6, 240),
      assumptions: stringList(record.assumptions, 8, 300),
    };
  } catch {
    return null;
  }
}

function providerStatusForResult(result: ModelProviderResult): ModelProviderStatus {
  if (result.providerStatus) return result.providerStatus;
  const configured = selectedModelProviderStatus();
  if (result.status === "available") {
    return {
      ...configured,
      provider: result.provider ?? configured.provider,
      state: "ready",
      ...(result.model ? { model: result.model } : {}),
      checkedAt: new Date().toISOString(),
      lastSuccessfulInferenceAt: new Date().toISOString(),
      identityVerified: result.identityVerified ?? false,
    };
  }
  return {
    ...configured,
    provider: result.provider ?? configured.provider,
    model: result.model ?? configured.model,
    state: configured.state === "unavailable" ? "unavailable" : "degraded",
    ...(result.reason ? { reason: result.reason } : {}),
    checkedAt: new Date().toISOString(),
  };
}

function catalogueContext() {
  return TECHNOLOGY_CATALOGUE.map((tool) => ({
    id: tool.id,
    name: tool.name,
    category: tool.category,
    description: tool.description,
    intendedUse: tool.intendedUse,
    pricingModel: tool.pricingModel,
    tags: tool.tags.slice(0, 8),
  }));
}

function fallbackResult(plan: SolutionPlan, reason: string | undefined): ServerPlanResult {
  return {
    plan,
    providerStatus: selectedModelProviderStatus(),
    usedFallback: true,
    ...(reason ? { reason } : {}),
  };
}

/**
 * Generate a server-owned plan when a configured model is available while
 * keeping all catalogue IDs, compatibility checks, source URLs, and fallback
 * behavior under application control.
 */
export async function generateServerSolutionPlan(
  request: ProjectRequest,
  version = 1,
): Promise<ServerPlanResult> {
  const deterministicPlan = generateSolutionPlan(request, version);
  const provider = getConfiguredModelProvider();
  if (!provider) return fallbackResult(deterministicPlan, "missing-config");

  const result = await provider.complete({
    system: [
      "You are Medharya's solution planning assistant.",
      "Return JSON only; do not use markdown or prose outside the JSON object.",
      "Select only IDs from the supplied catalogue. Do not invent tools, prices, URLs, compatibility, or completed actions.",
      "This is a planning suggestion, not live web research. Keep claims concise and state uncertainty in assumptions.",
      "The allowed JSON keys are summary, selectedToolIds, alternativeToolIds, openQuestions, and assumptions.",
    ].join(" "),
    context: JSON.stringify({ projectRequest: request, allowedCatalogue: catalogueContext() }),
    recentMessages: [],
    userMessage: "Choose a practical stack and return the allowed JSON object.",
  });
  const providerStatus = providerStatusForResult(result);
  if (result.status !== "available" || !result.text) {
    return {
      ...fallbackResult(deterministicPlan, result.reason),
      providerStatus,
      provider: result.provider,
      model: result.model,
    };
  }

  const signals = parseModelSignals(result.text);
  if (!signals) {
    return {
      ...fallbackResult(deterministicPlan, "invalid-response"),
      providerStatus: { ...providerStatus, state: "degraded", reason: "invalid-response" },
      provider: result.provider,
      model: result.model,
    };
  }

  const allowedIds = new Set(TECHNOLOGY_CATALOGUE.map((tool) => tool.id));
  const filteredSignals: ModelPlanSignals = {
    ...signals,
    selectedToolIds: signals.selectedToolIds.filter((id) => allowedIds.has(id)),
    alternativeToolIds: signals.alternativeToolIds.filter((id) => allowedIds.has(id)),
  };
  const plan = applyModelPlanSignals(request, deterministicPlan, filteredSignals, "model-assisted");
  if (plan === deterministicPlan) {
    return {
      ...fallbackResult(deterministicPlan, "invalid-response"),
      providerStatus: { ...providerStatus, state: "degraded", reason: "invalid-response" },
      provider: result.provider,
      model: result.model,
    };
  }

  return {
    plan,
    providerStatus,
    provider: result.provider,
    model: result.model,
    usedFallback: false,
  };
}
