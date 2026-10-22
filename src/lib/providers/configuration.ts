export const TOGETHER_DEFAULT_BASE_URL = "https://api.together.ai/v1";

const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 45_000;

/** @internal Raw deployment values are for configuration checks, not startup logging. */
export interface TogetherConfigurationDiagnostics {
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

function isTogetherProvider(provider: string | null) {
  return provider === "together" || provider === "together-ai";
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
export function resolveTogetherConfiguration(
  env: Readonly<Record<string, string | undefined>> = typeof process === "undefined" ? {} : process.env,
) {
  const provider = requestedProvider(env);
  const disabled = env.MEDHARYA_DISABLE_EXTERNAL_PROVIDERS === "1"
    || provider === "disabled" || provider === "none" || provider === "off";
  // Blank entries are absent; the first nonblank canonical/alias value wins unchanged.
  const apiKey = firstConfiguredValue(env.TOGETHER_API_KEY, env.MEDHARYA_TOGETHER_API_KEY, env.MEDHARYA_AI_API_KEY);
  const model = firstConfiguredValue(env.TOGETHER_MODEL, env.MEDHARYA_TOGETHER_MODEL, env.MEDHARYA_AI_MODEL);
  const configuredBaseUrl = firstConfiguredValue(env.TOGETHER_BASE_URL, env.MEDHARYA_TOGETHER_BASE_URL);
  const baseUrl = configuredBaseUrl ?? TOGETHER_DEFAULT_BASE_URL;
  const rawTimeout = firstConfiguredValue(env.TOGETHER_TIMEOUT_MS, env.MEDHARYA_TOGETHER_TIMEOUT_MS, env.MEDHARYA_AI_TIMEOUT_MS);
  const timeoutConfigured = rawTimeout === null || (Number.isFinite(Number(rawTimeout)) && Number(rawTimeout) > 0);
  const apiKeyConfigured = Boolean(apiKey);
  const modelConfigured = Boolean(model);
  const baseUrlValid = validBaseUrl(baseUrl);
  const explicitlyTogether = isTogetherProvider(provider);
  const implicitlyTogether = !provider && Boolean(configuredValue(env.TOGETHER_API_KEY) && configuredValue(env.TOGETHER_MODEL));
  const selected = !disabled && (explicitlyTogether || implicitlyTogether);
  const missing: string[] = [];

  if (selected && !apiKeyConfigured) missing.push("TOGETHER_API_KEY");
  if (selected && !modelConfigured) missing.push("TOGETHER_MODEL");
  if (selected && !baseUrlValid) missing.push("TOGETHER_BASE_URL");
  if (selected && !timeoutConfigured) missing.push("TOGETHER_TIMEOUT_MS");

  const diagnostics: TogetherConfigurationDiagnostics = {
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
    },
    diagnostics,
  };
}

export function getTogetherConfigurationDiagnostics(
  env: Readonly<Record<string, string | undefined>> = typeof process === "undefined" ? {} : process.env,
): TogetherConfigurationDiagnostics {
  return resolveTogetherConfiguration(env).diagnostics;
}
