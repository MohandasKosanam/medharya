import {
  PROVIDER_ERROR_REASONS,
  type ModelPrompt,
  type ModelProvider,
  type ModelProviderResult,
  type ModelProviderStatus,
  type ModelProviderUsage,
  type ProviderErrorReason,
} from "./types";

const OLLAMA_PROVIDER_ID = "ollama";
const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen3:4b";
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 900;
const CONTEXT_PREFIX = "Structured project context:\n";
const MAX_METADATA_CHARS = 256;

export const OLLAMA_PROVIDER_LIMITS = {
  maxSystemChars: 8_000,
  maxContextChars: 24_000,
  maxMessageChars: 4_000,
  maxRecentMessages: 8,
  maxHistoryMessageChars: 2_000,
  maxOutputChars: 12_000,
} as const;

export interface OllamaProviderResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown> | unknown;
}

export type OllamaProviderRequest = (
  input: string,
  init?: RequestInit,
) => OllamaProviderResponse | Promise<OllamaProviderResponse>;

export interface OllamaProviderOptions {
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  request?: OllamaProviderRequest;
}

export interface GetConfiguredOllamaProviderOptions {
  env?: Readonly<Record<string, string | undefined>>;
  request?: OllamaProviderRequest;
}

export interface NormalizedOllamaResponse {
  text: string;
  model?: string;
  usage?: ModelProviderUsage;
}

interface NormalizedOllamaConfig {
  model: string;
  baseUrl: string;
  timeoutMs: number;
  request: OllamaProviderRequest;
}

function configuredValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function boundedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function metadataText(value: unknown) {
  const text = boundedText(value, MAX_METADATA_CHARS);
  return text || undefined;
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function usageFromResponse(value: Record<string, unknown>): ModelProviderUsage | undefined {
  const usage: ModelProviderUsage = {};
  const promptTokens = tokenCount(value.prompt_eval_count);
  const completionTokens = tokenCount(value.eval_count);
  const totalTokens = tokenCount(value.total_tokens) ?? (
    promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null
  );

  if (promptTokens !== null) usage.promptTokens = promptTokens;
  if (completionTokens !== null) usage.completionTokens = completionTokens;
  if (totalTokens !== null) usage.totalTokens = totalTokens;

  return Object.keys(usage).length ? usage : undefined;
}

function visibleContent(value: unknown) {
  if (typeof value !== "string") return "";

  let text = value;
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");

  const unmatchedThinking = text.toLowerCase().lastIndexOf("<think>");
  if (unmatchedThinking >= 0) text = text.slice(0, unmatchedThinking);

  const unmatchedClosing = text.toLowerCase().lastIndexOf("</think>");
  if (unmatchedClosing >= 0) text = text.slice(unmatchedClosing + "</think>".length);

  return text.trim().slice(0, OLLAMA_PROVIDER_LIMITS.maxOutputChars);
}

function isLoopbackHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function normalizeBaseUrl(value: unknown) {
  const candidate = configuredValue(value) ?? DEFAULT_BASE_URL;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "http:" ||
      !isLoopbackHost(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }

    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${path}`;
  } catch {
    return null;
  }
}

function endpointFor(baseUrl: string) {
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.replace(/\/+$/, "");
  return new URL(`${basePath}/api/chat`, parsed.origin).toString();
}

function timeoutFor(value: unknown) {
  const parsed = Number(value);
  const timeout = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(timeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

function requestFrom(value: OllamaProviderRequest | undefined) {
  return value ?? fetch;
}

function runtimeEnvironment(): Readonly<Record<string, string | undefined>> {
  return typeof process === "undefined" ? {} : process.env;
}

function optionsFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  request?: OllamaProviderRequest,
): OllamaProviderOptions {
  return {
    model: env.MEDHARYA_OLLAMA_MODEL,
    baseUrl: env.MEDHARYA_OLLAMA_BASE_URL,
    timeoutMs: env.MEDHARYA_OLLAMA_TIMEOUT_MS ? Number(env.MEDHARYA_OLLAMA_TIMEOUT_MS) : undefined,
    request,
  };
}

function normalizeConfig(options: OllamaProviderOptions): NormalizedOllamaConfig | null {
  const model = configuredValue(options.model) ?? DEFAULT_MODEL;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!baseUrl) return null;

  return {
    model,
    baseUrl,
    timeoutMs: timeoutFor(options.timeoutMs),
    request: requestFrom(options.request),
  };
}

function providerOptionsFromInput(
  options: OllamaProviderOptions | GetConfiguredOllamaProviderOptions,
): OllamaProviderOptions {
  if ("env" in options) {
    return optionsFromEnvironment(options.env ?? runtimeEnvironment(), options.request);
  }
  return options;
}

function unavailable(reason: ProviderErrorReason, model: string | null): ModelProviderResult {
  return {
    status: "unavailable",
    provider: OLLAMA_PROVIDER_ID,
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

function boundedPrompt(prompt: ModelPrompt) {
  const candidate = prompt as Partial<ModelPrompt> | null | undefined;
  const system = boundedText(candidate?.system, OLLAMA_PROVIDER_LIMITS.maxSystemChars);
  const context = boundedText(
    candidate?.context,
    Math.max(OLLAMA_PROVIDER_LIMITS.maxContextChars - CONTEXT_PREFIX.length, 0),
  );
  const recentMessages = Array.isArray(candidate?.recentMessages)
    ? candidate.recentMessages
        .slice(-OLLAMA_PROVIDER_LIMITS.maxRecentMessages)
        .map((message) => ({
          role: message?.role === "assistant" ? "assistant" : "user",
          content: boundedText(message?.content, OLLAMA_PROVIDER_LIMITS.maxHistoryMessageChars),
        }))
    : [];

  return {
    system,
    context: `${CONTEXT_PREFIX}${context}`,
    recentMessages,
    userMessage: boundedText(candidate?.userMessage, OLLAMA_PROVIDER_LIMITS.maxMessageChars),
  };
}

export function normalizeOllamaResponse(value: unknown): NormalizedOllamaResponse | null {
  if (!isRecord(value) || value.done !== true || !isRecord(value.message)) return null;
  if (value.message.role !== undefined && value.message.role !== "assistant") return null;

  const text = visibleContent(value.message.content);
  if (!text) return null;
  const model = metadataText(value.model);
  const usage = usageFromResponse(value);

  return {
    text,
    ...(model ? { model } : {}),
    ...(usage ? { usage } : {}),
  };
}

async function requestOllamaOnce(
  config: NormalizedOllamaConfig,
  prompt: ModelPrompt,
): Promise<ModelProviderResult> {
  const safePrompt = boundedPrompt(prompt);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await config.request(endpointFor(config.baseUrl), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: safePrompt.system },
          { role: "system", content: safePrompt.context },
          ...safePrompt.recentMessages,
          { role: "user", content: safePrompt.userMessage },
        ],
        stream: false,
        think: false,
        options: {
          temperature: 0.2,
          num_predict: MAX_OUTPUT_TOKENS,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) return unavailable(reasonFromStatus(response.status), config.model);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return unavailable(PROVIDER_ERROR_REASONS.invalidResponse, config.model);
    }

    const normalized = normalizeOllamaResponse(payload);
    if (!normalized) return unavailable(PROVIDER_ERROR_REASONS.invalidResponse, config.model);

    return {
      status: "available",
      text: normalized.text,
      provider: OLLAMA_PROVIDER_ID,
      model: normalized.model ?? config.model,
      ...(normalized.usage ? { usage: normalized.usage } : {}),
    };
  } catch (error) {
    return unavailable(reasonFromRequestError(error), config.model);
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestOllama(
  options: OllamaProviderOptions,
  prompt: ModelPrompt,
  request?: OllamaProviderRequest,
): Promise<ModelProviderResult> {
  const config = normalizeConfig({ ...options, request: request ?? options.request });
  if (!config) return unavailable(PROVIDER_ERROR_REASONS.missingConfig, configuredValue(options.model));
  return requestOllamaOnce(config, prompt);
}

export function getOllamaProviderStatus(
  options: OllamaProviderOptions | GetConfiguredOllamaProviderOptions = {},
): ModelProviderStatus {
  const providerOptions = providerOptionsFromInput(options);
  const config = normalizeConfig(providerOptions);
  if (!config) {
    return {
      provider: OLLAMA_PROVIDER_ID,
      state: "unavailable",
      ...(configuredValue(providerOptions.model) ? { model: configuredValue(providerOptions.model) ?? undefined } : {}),
      reason: PROVIDER_ERROR_REASONS.missingConfig,
      identityVerified: false,
    };
  }

  return {
    provider: OLLAMA_PROVIDER_ID,
    model: config.model,
    state: "configured",
    identityVerified: false,
  };
}

export function createOllamaProvider(options: OllamaProviderOptions): ModelProvider {
  const model = configuredValue(options.model) ?? DEFAULT_MODEL;

  return {
    name: "Ollama provider",
    model,
    complete(prompt: ModelPrompt) {
      return requestOllama(options, prompt, options.request);
    },
    getStatus() {
      return getOllamaProviderStatus(options);
    },
  };
}

export function getConfiguredOllamaProvider(
  options: GetConfiguredOllamaProviderOptions | OllamaProviderRequest = {},
): ModelProvider | null {
  const request = typeof options === "function" ? options : options.request;
  const env = typeof options === "function" ? runtimeEnvironment() : options.env ?? runtimeEnvironment();
  const providerOptions = optionsFromEnvironment(env, request);
  return normalizeConfig(providerOptions) ? createOllamaProvider(providerOptions) : null;
}
