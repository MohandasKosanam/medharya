export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 45_000;

/** @internal Raw deployment values are for configuration checks, not startup logging. */
export interface OpenRouterConfigurationDiagnostics {
  selected: boolean;
  disabled: boolean;
  providerRequested: string | null;
  apiKeyConfigured: boolean;
  modelConfigured: boolean;
  model: string | null;
  baseUrl: string;
  baseUrlConfigured: boolean;
  baseUrlValid: boolean;
  timeoutMs: number;
  timeoutConfigured: boolean;
  ready: boolean;
  missing: string[];
}

function configuredValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstConfiguredValue(...values: (string | undefined)[]) {
  for (const value of values) {
    const configured = configuredValue(value);
    if (configured !== null) return configured;
  }
  return null;
}

function requestedProvider(env: Readonly<Record<string, string | undefined>>) {
  return configuredValue(env.MEDHARYA_AI_PROVIDER)?.toLowerCase() ?? null;
}

function isOpenRouterProvider(provider: string | null) {
  return provider === "openrouter" || provider === "open-router" || provider === "openrouter-ai";
}

function validBaseUrl(value: string) {
  try {
    const parsed = new URL(value);
    const loopback = parsed.hostname === "localhost"
      || parsed.hostname === "[::1]"
      || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname);
    return (parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback))
      && !parsed.username
      && !parsed.password
      && !value.includes("?")
      && !value.includes("#");
  } catch {
    return false;
  }
}

function effectiveTimeout(value: unknown) {
  const parsed = Number(value);
  const timeout = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(timeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

/** @internal Contains credentials and deployment values; do not log or expose this result. */
export function resolveOpenRouterConfiguration(
  env: Readonly<Record<string, string | undefined>> = typeof process === "undefined" ? {} : process.env,
) {
  const provider = requestedProvider(env);
  const disabled = env.MEDHARYA_DISABLE_EXTERNAL_PROVIDERS === "1"
    || provider === "disabled" || provider === "none" || provider === "off";
  const apiKey = firstConfiguredValue(env.OPENROUTER_API_KEY);
  const model = firstConfiguredValue(env.OPENROUTER_MODEL);
  const configuredBaseUrl = firstConfiguredValue(env.OPENROUTER_BASE_URL);
  const baseUrl = configuredBaseUrl ?? OPENROUTER_DEFAULT_BASE_URL;
  const rawTimeout = firstConfiguredValue(env.OPENROUTER_TIMEOUT_MS);
  const timeoutConfigured = rawTimeout === null || (Number.isFinite(Number(rawTimeout)) && Number(rawTimeout) > 0);
  const apiKeyConfigured = Boolean(apiKey);
  const modelConfigured = Boolean(model);
  const baseUrlValid = validBaseUrl(baseUrl);
  const explicitlyOpenRouter = isOpenRouterProvider(provider);
  const implicitlyOpenRouter = !provider && apiKeyConfigured && modelConfigured;
  const selected = !disabled && (explicitlyOpenRouter || implicitlyOpenRouter);
  const missing: string[] = [];

  if (selected && !apiKeyConfigured) missing.push("OPENROUTER_API_KEY");
  if (selected && !modelConfigured) missing.push("OPENROUTER_MODEL");
  if (selected && !baseUrlValid) missing.push("OPENROUTER_BASE_URL");
  if (selected && !timeoutConfigured) missing.push("OPENROUTER_TIMEOUT_MS");

  const diagnostics: OpenRouterConfigurationDiagnostics = {
    selected,
    disabled,
    providerRequested: provider,
    apiKeyConfigured,
    modelConfigured,
    model,
    baseUrl,
    baseUrlConfigured: Boolean(configuredBaseUrl),
    baseUrlValid,
    timeoutMs: effectiveTimeout(rawTimeout),
    timeoutConfigured,
    ready: selected && missing.length === 0,
    missing,
  };

  return {
    configuration: {
      apiKey: apiKey ?? undefined,
      model: model ?? undefined,
      baseUrl,
      timeoutMs: diagnostics.timeoutMs,
      headers: {
        ...(configuredValue(env.OPENROUTER_HTTP_REFERER) ? { "HTTP-Referer": configuredValue(env.OPENROUTER_HTTP_REFERER)! } : {}),
        ...(configuredValue(env.OPENROUTER_APP_TITLE) ? { "X-Title": configuredValue(env.OPENROUTER_APP_TITLE)! } : {}),
        "X-OpenRouter-Metadata": "enabled",
      },
    },
    diagnostics,
  };
}

export function getOpenRouterConfigurationDiagnostics(
  env: Readonly<Record<string, string | undefined>> = typeof process === "undefined" ? {} : process.env,
): OpenRouterConfigurationDiagnostics {
  return resolveOpenRouterConfiguration(env).diagnostics;
}
