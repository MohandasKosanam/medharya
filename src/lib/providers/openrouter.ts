import {
  PROVIDER_ERROR_REASONS,
  type ModelPrompt,
  type ModelProvider,
  type ModelProviderResult,
  type ModelProviderStatus,
} from "./types";
import {
  requestOpenAICompatible,
  type ModelProviderRequest,
  type OpenAICompatibleRequestConfig,
} from "./openai-compatible";
import {
  resolveOpenRouterConfiguration,
  OPENROUTER_DEFAULT_BASE_URL,
} from "./openrouter-configuration";

export const OPENROUTER_PROVIDER_ID = "openrouter";
export { OPENROUTER_DEFAULT_BASE_URL } from "./openrouter-configuration";

export interface OpenRouterProviderOptions extends OpenAICompatibleRequestConfig {
  request?: ModelProviderRequest;
}

export interface GetConfiguredOpenRouterProviderOptions {
  env?: Readonly<Record<string, string | undefined>>;
  request?: ModelProviderRequest;
}

function configuredValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function environment() {
  return typeof process === "undefined" ? {} : process.env;
}

function resolveProviderOptions(
  options: OpenRouterProviderOptions & GetConfiguredOpenRouterProviderOptions,
) {
  return "env" in options
    ? resolveOpenRouterConfiguration(options.env ?? environment())
    : resolveOpenRouterConfiguration({
        MEDHARYA_AI_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: options.apiKey,
        OPENROUTER_MODEL: options.model,
        OPENROUTER_BASE_URL: options.baseUrl,
        OPENROUTER_TIMEOUT_MS: options.timeoutMs?.toString(),
      });
}

function unavailable(model: string | null, reason = PROVIDER_ERROR_REASONS.missingConfig): ModelProviderResult {
  return {
    status: "unavailable",
    provider: OPENROUTER_PROVIDER_ID,
    ...(model ? { model } : {}),
    reason,
  };
}

function modelEndpoint(baseUrl: string, model: string) {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return null;
  const author = encodeURIComponent(model.slice(0, slash));
  const slug = encodeURIComponent(model.slice(slash + 1));
  return `${baseUrl.replace(/\/+$/, "")}/model/${author}/${slug}`;
}

async function healthFor(
  configuration: OpenRouterProviderOptions,
  model: string,
): Promise<ModelProviderStatus> {
  const endpoint = modelEndpoint(configuration.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL, model);
  if (!endpoint) {
    return {
      provider: OPENROUTER_PROVIDER_ID,
      model,
      state: "unavailable",
      reason: PROVIDER_ERROR_REASONS.modelMissing,
      identityVerified: false,
    };
  }

  const request = configuration.request ?? fetch;
  try {
    const response = await request(endpoint, {
      method: "GET",
      headers: {
        ...(configuration.headers ?? {}),
        Authorization: `Bearer ${configuration.apiKey}`,
      },
    });
    if (response.status === 401 || response.status === 403) {
      return { provider: OPENROUTER_PROVIDER_ID, model, state: "unavailable", reason: PROVIDER_ERROR_REASONS.auth, identityVerified: false };
    }
    if (response.status === 404) {
      return { provider: OPENROUTER_PROVIDER_ID, model, state: "unavailable", reason: PROVIDER_ERROR_REASONS.modelMissing, identityVerified: false };
    }
    if (response.status === 429) {
      return { provider: OPENROUTER_PROVIDER_ID, model, state: "unavailable", reason: PROVIDER_ERROR_REASONS.rateLimit, identityVerified: false };
    }
    if (!response.ok) {
      return { provider: OPENROUTER_PROVIDER_ID, model, state: "unavailable", reason: response.status >= 500 ? PROVIDER_ERROR_REASONS.transientError : PROVIDER_ERROR_REASONS.invalidResponse, identityVerified: false };
    }
    const payload = await response.json();
    const data = typeof payload === "object" && payload !== null && "data" in payload && typeof payload.data === "object" && payload.data !== null
      ? payload.data
      : payload;
    const returnedModel = typeof data === "object" && data !== null && "id" in data && typeof data.id === "string"
      ? data.id
      : null;
    if (returnedModel !== model && !(typeof data === "object" && data !== null && "canonical_slug" in data && data.canonical_slug === model)) {
      return { provider: OPENROUTER_PROVIDER_ID, model, state: "unavailable", reason: PROVIDER_ERROR_REASONS.invalidResponse, identityVerified: false };
    }
    return {
      provider: OPENROUTER_PROVIDER_ID,
      model,
      state: "ready",
      checkedAt: new Date().toISOString(),
      identityVerified: true,
    };
  } catch (error) {
    return {
      provider: OPENROUTER_PROVIDER_ID,
      model,
      state: "unavailable",
      reason: error instanceof Error && error.name === "AbortError" ? PROVIDER_ERROR_REASONS.timeout : PROVIDER_ERROR_REASONS.transientError,
      identityVerified: false,
    };
  }
}

export async function requestOpenRouter(
  options: OpenRouterProviderOptions,
  prompt: ModelPrompt,
  request?: ModelProviderRequest,
): Promise<ModelProviderResult> {
  const { configuration, diagnostics } = resolveProviderOptions(options);
  if (!diagnostics.ready) return unavailable(diagnostics.model);

  const result = await requestOpenAICompatible({
    ...configuration,
    headers: options.headers ?? configuration.headers,
  }, prompt, request ?? options.request);
  return { ...result, provider: OPENROUTER_PROVIDER_ID };
}

export function getOpenRouterProviderStatus(
  options: OpenRouterProviderOptions | GetConfiguredOpenRouterProviderOptions = {},
): ModelProviderStatus {
  const { diagnostics } = resolveProviderOptions(options);
  if (!diagnostics.ready) {
    return {
      provider: OPENROUTER_PROVIDER_ID,
      state: "unavailable",
      ...(diagnostics.model ? { model: diagnostics.model } : {}),
      reason: PROVIDER_ERROR_REASONS.missingConfig,
      identityVerified: false,
    };
  }
  return {
    provider: OPENROUTER_PROVIDER_ID,
    model: diagnostics.model ?? undefined,
    state: "configured",
    identityVerified: false,
  };
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions): ModelProvider {
  const model = configuredValue(options.model) ?? "";
  let currentStatus = getOpenRouterProviderStatus(options);
  return {
    name: "OpenRouter",
    model,
    complete(prompt: ModelPrompt) {
      return requestOpenRouter(options, prompt, options.request);
    },
    async health() {
      const { configuration, diagnostics } = resolveProviderOptions(options);
      currentStatus = diagnostics.ready && diagnostics.model
        ? await healthFor({ ...options, ...configuration, headers: options.headers ?? configuration.headers }, diagnostics.model)
        : getOpenRouterProviderStatus(options);
      return currentStatus;
    },
    getStatus() {
      return currentStatus;
    },
  };
}

export function getConfiguredOpenRouterProvider(
  options: GetConfiguredOpenRouterProviderOptions | ModelProviderRequest = {},
): ModelProvider | null {
  const request = typeof options === "function" ? options : options.request;
  const env = typeof options === "function" ? environment() : options.env ?? environment();
  const { configuration, diagnostics } = resolveOpenRouterConfiguration(env);
  return diagnostics.ready ? createOpenRouterProvider({ ...configuration, request }) : null;
}

export { getOpenRouterConfigurationDiagnostics } from "./openrouter-configuration";
