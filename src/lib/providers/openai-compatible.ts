import {
  PROVIDER_ERROR_REASONS,
  type ModelPrompt,
  type ModelProvider,
  type ModelProviderResult,
  type ModelProviderStatus,
  type ModelProviderUsage,
  type ProviderErrorReason,
} from "./types";
import {
  getConfiguredMedharyaAlphaProvider,
  getMedharyaAlphaHealthStatus,
  toMedharyaAlphaProviderStatus,
} from "./alpha";
import { getConfiguredOllamaProvider, getOllamaProviderStatus } from "./ollama";
import { getConfiguredTogetherProvider, getTogetherProviderStatus } from "./together";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 900;
const MAX_REQUEST_ATTEMPTS = 2;
const RETRY_DELAY_MS = 100;
const CONTEXT_PREFIX = "Structured project context:\n";

export const MODEL_PROVIDER_LIMITS = {
  maxPromptChars: 8_000,
  maxContextChars: 24_000,
  maxMessageChars: 4_000,
  maxRecentMessages: 8,
  maxOutputChars: 12_000,
} as const;

export const MAX_PROMPT_CHARS = MODEL_PROVIDER_LIMITS.maxPromptChars;
export const MAX_CONTEXT_CHARS = MODEL_PROVIDER_LIMITS.maxContextChars;
export const MAX_MESSAGE_CHARS = MODEL_PROVIDER_LIMITS.maxMessageChars;
export const MAX_OUTPUT_CHARS = MODEL_PROVIDER_LIMITS.maxOutputChars;

export interface ProviderResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown> | unknown;
}

export type ModelProviderRequest = (input: string, init?: RequestInit) => ProviderResponse | Promise<ProviderResponse>;
export type ProviderRequest = ModelProviderRequest;

export interface OpenAICompatibleRequestConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface OpenAICompatibleProviderOptions extends OpenAICompatibleRequestConfig {
  request?: ModelProviderRequest;
}

export interface GetConfiguredModelProviderOptions {
  env?: Readonly<Record<string, string | undefined>>;
  request?: ModelProviderRequest;
}

export interface NormalizedOpenAICompatibleResponse {
  text: string;
  model?: string;
  usage?: ModelProviderUsage;
}

function configuredValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function boundedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function usageFromResponse(value: unknown): ModelProviderUsage | undefined {
  if (!isRecord(value)) return undefined;

  const usage: ModelProviderUsage = {};
  const promptTokens = tokenCount(value.prompt_tokens ?? value.promptTokens ?? value.input_tokens ?? value.inputTokens);
  const completionTokens = tokenCount(
    value.completion_tokens ?? value.completionTokens ?? value.output_tokens ?? value.outputTokens,
  );
  const totalTokens = tokenCount(value.total_tokens ?? value.totalTokens);

  if (promptTokens !== null) usage.promptTokens = promptTokens;
  if (completionTokens !== null) usage.completionTokens = completionTokens;
  if (totalTokens !== null) usage.totalTokens = totalTokens;

  return Object.keys(usage).length ? usage : undefined;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      if (typeof part.text === "string") return part.text;
      if (isRecord(part.text) && typeof part.text.value === "string") return part.text.value;
      return "";
    })
    .join("");
}

export function normalizeOpenAICompatibleResponse(value: unknown): NormalizedOpenAICompatibleResponse | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;

  const firstChoice = value.choices[0];
  if (!isRecord(firstChoice)) return null;

  const message = isRecord(firstChoice.message) ? firstChoice.message : null;
  const messageText = message ? contentText(message.content) : "";
  const text = boundedText(messageText, MAX_OUTPUT_CHARS) || boundedText(firstChoice.text, MAX_OUTPUT_CHARS);
  const model = boundedText(value.model, 256);
  const usage = usageFromResponse(value.usage);
  if (!text) return null;

  return {
    text,
    ...(model ? { model } : {}),
    ...(usage ? { usage } : {}),
  };
}

function isValidBaseUrl(baseUrl: string) {
  try {
    const parsedUrl = new URL(baseUrl);
    return (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") && !parsedUrl.username && !parsedUrl.password;
  } catch {
    return false;
  }
}

function timeoutFor(value: unknown) {
  const parsed = Number(value);
  const timeout = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(timeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

function boundedPrompt(prompt: ModelPrompt) {
  const candidate = prompt as Partial<ModelPrompt> | null | undefined;
  const system = boundedText(candidate?.system, MAX_PROMPT_CHARS);
  const context = boundedText(candidate?.context, Math.max(MAX_CONTEXT_CHARS - CONTEXT_PREFIX.length, 0));
  const recentMessages = Array.isArray(candidate?.recentMessages)
    ? candidate.recentMessages.slice(-MODEL_PROVIDER_LIMITS.maxRecentMessages).map((message) => ({
        role: message?.role === "assistant" ? "assistant" : "user",
        content: boundedText(message?.content, MAX_MESSAGE_CHARS),
      }))
    : [];
  const userMessage = boundedText(candidate?.userMessage, MAX_MESSAGE_CHARS);

  return {
    system,
    context: `${CONTEXT_PREFIX}${context}`,
    recentMessages,
    userMessage,
  };
}

function unavailable(reason: ProviderErrorReason, model: string | null): ModelProviderResult {
  return {
    status: "unavailable",
    provider: "openai-compatible",
    ...(model ? { model } : {}),
    reason,
  };
}

function isAbortError(error: unknown) {
  return (error instanceof Error && error.name === "AbortError") || (isRecord(error) && error.name === "AbortError");
}

function reasonFromRequestError(error: unknown): ProviderErrorReason {
  return isAbortError(error) ? PROVIDER_ERROR_REASONS.timeout : PROVIDER_ERROR_REASONS.transientError;
}

function reasonFromStatus(status: number): ProviderErrorReason {
  if (status === 401 || status === 403) return PROVIDER_ERROR_REASONS.auth;
  if (status === 408 || status === 504) return PROVIDER_ERROR_REASONS.timeout;
  if (status === 429) return PROVIDER_ERROR_REASONS.rateLimit;
  if (status >= 500) return PROVIDER_ERROR_REASONS.transientError;
  return PROVIDER_ERROR_REASONS.invalidResponse;
}

function requestFrom(value: ModelProviderRequest | { request?: ModelProviderRequest } | undefined) {
  if (typeof value === "function") return value;
  return value?.request ?? fetch;
}

function retryableReason(reason: ProviderErrorReason | undefined) {
  return reason === PROVIDER_ERROR_REASONS.timeout || reason === PROVIDER_ERROR_REASONS.rateLimit || reason === PROVIDER_ERROR_REASONS.transientError;
}

function waitBeforeRetry(attempt: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
}

async function requestOnce(
  config: OpenAICompatibleRequestConfig,
  prompt: ModelPrompt,
  request: ModelProviderRequest,
): Promise<ModelProviderResult> {
  const apiKey = configuredValue(config.apiKey);
  const model = configuredValue(config.model);
  const baseUrl = configuredValue(config.baseUrl) ?? DEFAULT_BASE_URL;

  if (!apiKey || !model || !isValidBaseUrl(baseUrl)) {
    return unavailable(PROVIDER_ERROR_REASONS.missingConfig, model);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutFor(config.timeoutMs));

  try {
    const safePrompt = boundedPrompt(prompt);
    const response = await request(endpointFor(baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: safePrompt.system },
          { role: "system", content: safePrompt.context },
          ...safePrompt.recentMessages,
          { role: "user", content: safePrompt.userMessage },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) return unavailable(reasonFromStatus(response.status), model);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return unavailable(PROVIDER_ERROR_REASONS.invalidResponse, model);
    }

    const normalized = normalizeOpenAICompatibleResponse(payload);
    if (!normalized) return unavailable(PROVIDER_ERROR_REASONS.invalidResponse, model);
    if (normalized.model && normalized.model !== model) {
      return unavailable(PROVIDER_ERROR_REASONS.invalidResponse, model);
    }

    return {
      status: "available",
      text: normalized.text,
      provider: "openai-compatible",
      model,
      identityVerified: Boolean(normalized.model && normalized.model === model),
      ...(normalized.usage ? { usage: normalized.usage } : {}),
    };
  } catch (error) {
    return unavailable(reasonFromRequestError(error), model);
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestOpenAICompatible(
  config: OpenAICompatibleRequestConfig,
  prompt: ModelPrompt,
  requestOrOptions?: ModelProviderRequest | { request?: ModelProviderRequest },
): Promise<ModelProviderResult> {
  const apiKey = configuredValue(config.apiKey);
  const model = configuredValue(config.model);
  const baseUrl = configuredValue(config.baseUrl) ?? DEFAULT_BASE_URL;

  if (!apiKey || !model || !isValidBaseUrl(baseUrl)) {
    return unavailable(PROVIDER_ERROR_REASONS.missingConfig, model);
  }

  const request = requestFrom(requestOrOptions);
  let result: ModelProviderResult = unavailable(PROVIDER_ERROR_REASONS.transientError, model);
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
    result = await requestOnce({ ...config, apiKey, model, baseUrl }, prompt, request);
    if (result.status === "available" || !retryableReason(result.reason) || attempt === MAX_REQUEST_ATTEMPTS - 1) {
      return result;
    }
    await waitBeforeRetry(attempt);
  }

  return result;
}

export function createOpenAICompatibleProvider(options: OpenAICompatibleProviderOptions): ModelProvider {
  const model = configuredValue(options.model) ?? "";
  const request = options.request;

  return {
    name: "OpenAI-compatible provider",
    model,
    complete(prompt: ModelPrompt) {
      return requestOpenAICompatible(
        {
          apiKey: options.apiKey,
          model: options.model,
          baseUrl: options.baseUrl,
          timeoutMs: options.timeoutMs,
        },
        prompt,
        request,
      );
    },
  };
}

export function getConfiguredModelProvider(
  options: GetConfiguredModelProviderOptions | ModelProviderRequest = {},
): ModelProvider | null {
  return selectModelProvider(options);
}

export function selectModelProvider(
  options: GetConfiguredModelProviderOptions | ModelProviderRequest = {},
): ModelProvider | null {
  const request = typeof options === "function" ? options : options.request;
  const env = typeof options === "function" ? process.env : options.env ?? process.env;
  if (env.MEDHARYA_DISABLE_EXTERNAL_PROVIDERS === "1") return null;

  const requestedProvider = env.MEDHARYA_AI_PROVIDER?.trim().toLowerCase();
  if (requestedProvider === "alpha" || requestedProvider === "medharya-alpha") {
    return getConfiguredMedharyaAlphaProvider({ env, request });
  }
  if (requestedProvider === "ollama") {
    return getConfiguredOllamaProvider({ env, request });
  }
  if (requestedProvider === "together" || requestedProvider === "together-ai") {
    return getConfiguredTogetherProvider({ env, request });
  }
  if (requestedProvider === "disabled" || requestedProvider === "none" || requestedProvider === "off") return null;

  if (!requestedProvider && configuredValue(env.TOGETHER_API_KEY) && configuredValue(env.TOGETHER_MODEL)) {
    return getConfiguredTogetherProvider({ env, request });
  }

  const apiKey = configuredValue(env.MEDHARYA_AI_API_KEY);
  const model = configuredValue(env.MEDHARYA_AI_MODEL);
  const baseUrl = configuredValue(env.MEDHARYA_AI_BASE_URL) ?? DEFAULT_BASE_URL;

  if (!apiKey || !model || !isValidBaseUrl(baseUrl)) return null;

  return createOpenAICompatibleProvider({
    apiKey,
    model,
    baseUrl,
    timeoutMs: env.MEDHARYA_AI_TIMEOUT_MS ? Number(env.MEDHARYA_AI_TIMEOUT_MS) : undefined,
    request,
  });
}

export const selectConfiguredModelProvider = selectModelProvider;

export function selectedModelProviderStatus(
  options: GetConfiguredModelProviderOptions | ModelProviderRequest = {},
): ModelProviderStatus {
  const env = typeof options === "function" ? process.env : options.env ?? process.env;
  if (env.MEDHARYA_DISABLE_EXTERNAL_PROVIDERS === "1") {
    return {
      provider: "none",
      state: "unavailable",
      reason: PROVIDER_ERROR_REASONS.missingConfig,
      identityVerified: false,
    };
  }

  const requestedProvider = env.MEDHARYA_AI_PROVIDER?.trim().toLowerCase();
  if (requestedProvider === "alpha" || requestedProvider === "medharya-alpha") {
    return toMedharyaAlphaProviderStatus(getMedharyaAlphaHealthStatus({ env }), { env });
  }
  if (requestedProvider === "ollama") {
    return getOllamaProviderStatus({ env });
  }
  if (requestedProvider === "together" || requestedProvider === "together-ai") {
    return getTogetherProviderStatus({ env });
  }
  if (requestedProvider === "disabled" || requestedProvider === "none" || requestedProvider === "off") {
    return {
      provider: "none",
      state: "unavailable",
      reason: PROVIDER_ERROR_REASONS.missingConfig,
      identityVerified: false,
    };
  }

  if (!requestedProvider && configuredValue(env.TOGETHER_API_KEY) && configuredValue(env.TOGETHER_MODEL)) {
    return getTogetherProviderStatus({ env });
  }

  const apiKey = configuredValue(env.MEDHARYA_AI_API_KEY);
  const model = configuredValue(env.MEDHARYA_AI_MODEL);
  const baseUrl = configuredValue(env.MEDHARYA_AI_BASE_URL) ?? DEFAULT_BASE_URL;
  if (!apiKey || !model || !isValidBaseUrl(baseUrl)) {
    return {
      provider: "openai-compatible",
      state: "unavailable",
      ...(model ? { model } : {}),
      reason: PROVIDER_ERROR_REASONS.missingConfig,
      identityVerified: false,
    };
  }
  return {
    provider: "openai-compatible",
    model,
    state: "configured",
    identityVerified: false,
  };
}

export function modelProviderConfigurationStatus(
  options?: GetConfiguredModelProviderOptions | ModelProviderRequest,
): "configured" | "not-configured" {
  return getConfiguredModelProvider(options) ? "configured" : "not-configured";
}
