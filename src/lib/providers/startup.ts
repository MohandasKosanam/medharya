import { selectedModelProviderStatus } from "./openai-compatible";
import { getOpenRouterConfigurationDiagnostics } from "./openrouter-configuration";
import { toMedharyaAlphaProviderStatus } from "./alpha";

const PROVIDERS = ["none", "openai-compatible", "openrouter", "ollama", "medharya-alpha"] as const;
const STATES = ["configured", "unavailable"] as const;
const REASONS = ["missing-config", "auth", "rate-limit", "timeout", "transient-error", "model-missing", "invalid-response"] as const;
const OPENROUTER_VARIABLES = ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_BASE_URL", "OPENROUTER_TIMEOUT_MS"] as const;

function boundedTimeout(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.max(Math.trunc(value), 2_000), 45_000)
    : 15_000;
}

/** Configuration only: no environment reads, logging, health checks, or inference. */
export function getProviderStartupDiagnostics(
  env: Readonly<Record<string, string | undefined>> = {},
) {
  const status = selectedModelProviderStatus({ env });
  // Alpha's normal status can include cached live health. Use only its configuration
  // validation so identical inputs produce identical startup diagnostics.
  const selected = status.provider === "medharya-alpha"
    ? toMedharyaAlphaProviderStatus({
        provider: "medharya-alpha",
        state: "configured",
        status: "configured",
        identityVerified: false,
      }, { env })
    : status;
  const openrouter = getOpenRouterConfigurationDiagnostics(env);

  // Select literals from allowlists instead of forwarding any provider-owned
  // strings: even model names and URLs can contain accidentally pasted secrets.
  return {
    provider: PROVIDERS.find((provider) => provider === selected.provider) ?? "unknown",
    state: STATES.find((state) => state === selected.state) ?? "unavailable",
    reason: selected.reason === undefined
      ? "none"
      : REASONS.find((reason) => reason === selected.reason) ?? "unknown",
    identityVerified: false as const,
    inferenceVerified: false as const,
    openrouter: {
      selected: openrouter.selected === true,
      apiKeyConfigured: openrouter.apiKeyConfigured === true,
      modelConfigured: openrouter.modelConfigured === true,
      baseUrlConfigured: openrouter.baseUrlConfigured === true,
      baseUrlValid: openrouter.baseUrlValid === true,
      timeoutMs: boundedTimeout(openrouter.timeoutMs),
      timeoutConfigured: openrouter.timeoutConfigured === true,
      ready: openrouter.ready === true,
      missing: OPENROUTER_VARIABLES.filter((variable) => Array.isArray(openrouter.missing) && openrouter.missing.includes(variable)),
    },
  };
}
