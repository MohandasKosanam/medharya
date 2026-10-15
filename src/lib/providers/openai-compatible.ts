import type { ModelPrompt, ModelProvider, ModelProviderResult } from "./types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const MAX_MODEL_OUTPUT = 12_000;

function configuredValue(value: string | undefined) {
  return value?.trim() || null;
}

function endpointFor(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function responseText(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const firstChoice = value.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) return null;
  return typeof firstChoice.message.content === "string"
    ? firstChoice.message.content.trim().slice(0, MAX_MODEL_OUTPUT)
    : null;
}

function statusFromError(error: unknown): ModelProviderResult["reason"] {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "provider-error";
}

export function getConfiguredModelProvider(): ModelProvider | null {
  const apiKey = configuredValue(process.env.MEDHARYA_AI_API_KEY);
  const model = configuredValue(process.env.MEDHARYA_AI_MODEL);
  const baseUrl = configuredValue(process.env.MEDHARYA_AI_BASE_URL) ?? DEFAULT_BASE_URL;

  if (!apiKey || !model) return null;

  try {
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") return null;
  } catch {
    return null;
  }

  return {
    name: "OpenAI-compatible provider",
    model,
    async complete(prompt: ModelPrompt) {
      const controller = new AbortController();
      const timeoutMs = Math.min(
        Math.max(Number(process.env.MEDHARY_AI_TIMEOUT_MS) || 15_000, 2_000),
        45_000,
      );
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(endpointFor(baseUrl), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 900,
            messages: [
              { role: "system", content: prompt.system },
              { role: "system", content: `Structured project context:\n${prompt.context}` },
              ...prompt.recentMessages,
              { role: "user", content: prompt.userMessage },
            ],
          }),
          signal: controller.signal,
        });

        if (response.status === 429) {
          return { status: "unavailable", provider: "openai-compatible", model, reason: "rate-limited" };
        }
        if (!response.ok) {
          return { status: "unavailable", provider: "openai-compatible", model, reason: "provider-error" };
        }

        const payload: unknown = await response.json();
        const text = responseText(payload);
        return text
          ? { status: "available", text, provider: "openai-compatible", model }
          : { status: "unavailable", provider: "openai-compatible", model, reason: "invalid-response" };
      } catch (error) {
        return {
          status: "unavailable",
          provider: "openai-compatible",
          model,
          reason: statusFromError(error),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function modelProviderConfigurationStatus() {
  return getConfiguredModelProvider() ? "configured" : "not-configured";
}
