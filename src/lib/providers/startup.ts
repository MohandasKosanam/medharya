import { selectedModelProviderStatus } from "./openai-compatible";
import { getTogetherConfigurationDiagnostics } from "./configuration";
import { toMedharyaAlphaProviderStatus } from "./alpha";

const PROVIDERS = ["none", "openai-compatible", "together-ai", "ollama", "medharya-alpha"] as const;
const STATES = ["configured", "unavailable"] as const;
const REASONS = ["missing-config", "auth", "rate-limit", "timeout", "transient-error", "model-missing", "invalid-response"] as const;
const TOGETHER_VARIABLES = ["TOGETHER_API_KEY", "TOGETHER_MODEL", "TOGETHER_BASE_URL", "TOGETHER_TIMEOUT_MS"] as const;

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
  const together = getTogetherConfigurationDiagnostics(env);

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
    together: {
      selected: together.selected === true,
      apiKeyConfigured: together.apiKeyConfigured === true,
      modelConfigured: together.modelConfigured === true,
      baseUrlConfigured: together.baseUrlConfigured === true,
      baseUrlValid: together.baseUrlValid === true,
      timeoutMs: boundedTimeout(together.timeoutMs),
      timeoutConfigured: together.timeoutConfigured === true,
      ready: together.ready === true,
      missing: TOGETHER_VARIABLES.filter((variable) => Array.isArray(together.missing) && together.missing.includes(variable)),
    },
  };
}
