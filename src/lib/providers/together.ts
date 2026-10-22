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
import { resolveTogetherConfiguration } from "./configuration";

export const TOGETHER_PROVIDER_ID = "together-ai";
export { TOGETHER_DEFAULT_BASE_URL } from "./configuration";

export interface TogetherProviderOptions extends OpenAICompatibleRequestConfig {
  request?: ModelProviderRequest;
}

export interface GetConfiguredTogetherProviderOptions {
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
  options: TogetherProviderOptions & GetConfiguredTogetherProviderOptions,
) {
  return "env" in options
    ? resolveTogetherConfiguration(options.env ?? environment())
    : resolveTogetherConfiguration({
        MEDHARYA_AI_PROVIDER: "together",
        TOGETHER_API_KEY: options.apiKey,
        TOGETHER_MODEL: options.model,
        TOGETHER_BASE_URL: options.baseUrl,
        TOGETHER_TIMEOUT_MS: options.timeoutMs?.toString(),
      });
}

function unavailable(model: string | null): ModelProviderResult {
  return {
    status: "unavailable",
    provider: TOGETHER_PROVIDER_ID,
    ...(model ? { model } : {}),
    reason: PROVIDER_ERROR_REASONS.missingConfig,
  };
}

export async function requestTogether(
  options: TogetherProviderOptions,
  prompt: ModelPrompt,
  request?: ModelProviderRequest,
): Promise<ModelProviderResult> {
  const { configuration, diagnostics } = resolveProviderOptions(options);
  if (!diagnostics.ready) return unavailable(diagnostics.model);

  const result = await requestOpenAICompatible(
    configuration,
    prompt,
    request ?? options.request,
  );

  return {
    ...result,
    provider: TOGETHER_PROVIDER_ID,
  };
}

export function getTogetherProviderStatus(
  options: TogetherProviderOptions | GetConfiguredTogetherProviderOptions = {},
): ModelProviderStatus {
  const { diagnostics } = resolveProviderOptions(options);
  const model = diagnostics.model;
  if (!diagnostics.ready) {
    return {
      provider: TOGETHER_PROVIDER_ID,
      state: "unavailable",
      ...(model ? { model } : {}),
      reason: PROVIDER_ERROR_REASONS.missingConfig,
      identityVerified: false,
    };
  }

  return {
    provider: TOGETHER_PROVIDER_ID,
    model: model ?? undefined,
    state: "configured",
    identityVerified: false,
  };
}

export function createTogetherProvider(options: TogetherProviderOptions): ModelProvider {
  const model = configuredValue(options.model) ?? "";
  return {
    name: "Together AI",
    model,
    complete(prompt: ModelPrompt) {
      return requestTogether(options, prompt, options.request);
    },
    getStatus() {
      return getTogetherProviderStatus(options);
    },
  };
}

export function getConfiguredTogetherProvider(
  options: GetConfiguredTogetherProviderOptions | ModelProviderRequest = {},
): ModelProvider | null {
  const request = typeof options === "function" ? options : options.request;
  const env = typeof options === "function" ? environment() : options.env ?? environment();
  const { configuration, diagnostics } = resolveTogetherConfiguration(env);
  return diagnostics.ready ? createTogetherProvider({ ...configuration, request }) : null;
}

export { getTogetherConfigurationDiagnostics } from "./configuration";
