import {
  PROVIDER_ERROR_REASONS,
  type ModelPrompt,
  type ModelProvider,
  type ModelProviderResult,
  type ModelProviderUsage,
  type ProviderErrorReason,
} from "./types";

const ALPHA_PROVIDER_ID = "medharya-alpha";
const DEFAULT_BASE_URL = "";
const DEFAULT_HEALTH_PATH = "/health";
const DEFAULT_CHAT_PATH = "/chat";
const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_CONCURRENT = 4;
const MAX_MAX_CONCURRENT = 32;
const MAX_QUEUED_REQUESTS = 100;
const DEFAULT_MAX_OUTPUT_TOKENS = 900;
const MAX_MAX_OUTPUT_TOKENS = 4_096;
const MAX_REQUEST_CHARS = 80_000;
const MAX_METADATA_CHARS = 256;

export const MEDHARYA_ALPHA_LIMITS = {
  maxSystemChars: 8_000,
  maxContextChars: 24_000,
  maxMessageChars: 4_000,
  maxHistoryMessages: 8,
  maxHistoryMessageChars: 2_000,
  maxOutputChars: 12_000,
} as const;

export interface AlphaProviderResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown> | unknown;
}

export type AlphaModelProviderRequest = (
  input: string,
  init?: RequestInit,
) => AlphaProviderResponse | Promise<AlphaProviderResponse>;

export interface MedharyaAlphaProviderOptions {
  apiKey?: string;
  model?: string;
  baseModel?: string;
  adapterVersion?: string;
  baseUrl?: string;
  healthPath?: string;
  chatPath?: string;
  timeoutMs?: number;
  maxConcurrent?: number;
  maxOutputTokens?: number;
  allowInsecureLocal?: boolean | string;
  request?: AlphaModelProviderRequest;
}

export interface GetConfiguredMedharyaAlphaProviderOptions {
  env?: Readonly<Record<string, string | undefined>>;
  request?: AlphaModelProviderRequest;
}

export interface NormalizedMedharyaAlphaResponse {
  text: string;
  model?: string;
  baseModel?: string;
  adapterVersion?: string;
  usage?: ModelProviderUsage;
}

export type MedharyaAlphaHealthState =
  | "configured"
  | "connecting"
  | "ready"
  | "degraded"
  | "unavailable";

export interface MedharyaAlphaLastSuccessMetadata {
  checkedAt: string;
  model?: string;
  baseModel?: string;
  adapterVersion?: string;
}

export interface MedharyaAlphaHealthStatus {
  state: MedharyaAlphaHealthState;
  // `status` mirrors `state` for callers that use status-oriented health APIs.
  status: MedharyaAlphaHealthState;
  checkedAt?: string;
  httpStatus?: number;
  reason?: ProviderErrorReason;
  observed?: {
    model?: string;
    baseModel?: string;
    adapterVersion?: string;
  };
  lastSuccess?: MedharyaAlphaLastSuccessMetadata;
  lastSuccessAt?: string;
}

export interface MedharyaAlphaProvider extends ModelProvider {
  health(): Promise<MedharyaAlphaHealthStatus>;
  getHealthStatus(): MedharyaAlphaHealthStatus;
}

interface NormalizedAlphaConfig {
  apiKey: string;
  model: string;
  baseModel?: string;
  adapterVersion?: string;
  baseUrl: string;
  healthPath: string;
  chatPath: string;
  timeoutMs: number;
  maxConcurrent: number;
  maxOutputTokens: number;
  allowInsecureLocal: boolean;
  request: AlphaModelProviderRequest;
}

interface AlphaQueueEntry<T> {
  limit: number;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

let activeAlphaRequests = 0;
const alphaRequestQueue: Array<AlphaQueueEntry<unknown>> = [];

class AlphaQueueCapacityError extends Error {
  constructor() {
    super("The Medharya Alpha request queue is full.");
    this.name = "AlphaQueueCapacityError";
  }
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

function adapterMetadata(value: Record<string, unknown>) {
  if (value.adapter_version !== undefined) return metadataText(value.adapter_version);
  if (value.adapterVersion !== undefined) return metadataText(value.adapterVersion);
  if (typeof value.adapter === "string") return metadataText(value.adapter);
  if (isRecord(value.adapter)) return metadataText(value.adapter.version ?? value.adapter.name);
  return undefined;
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000_000
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

function booleanOption(value: unknown) {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function timeoutFor(value: unknown) {
  const parsed = Number(value);
  const timeout = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(timeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

function maxConcurrentFor(value: unknown) {
  const parsed = Number(value);
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_CONCURRENT;
  return Math.min(Math.max(limit, 1), MAX_MAX_CONCURRENT);
}

function maxOutputTokensFor(value: unknown) {
  const parsed = Number(value);
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.min(Math.max(limit, 1), MAX_MAX_OUTPUT_TOKENS);
}

function isLocalAlphaHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}

function normalizeBaseUrl(value: unknown, allowInsecureLocal: boolean) {
  const candidate = configuredValue(value);
  if (!candidate) return DEFAULT_BASE_URL;

  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.protocol !== "https:") {
      if (parsed.protocol !== "http:" || !allowInsecureLocal || !isLocalAlphaHost(parsed.hostname)) return null;
    }

    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${path}`;
  } catch {
    return null;
  }
}

function normalizeServicePath(value: unknown, fallback: string) {
  const candidate = configuredValue(value) ?? fallback;
  if (
    candidate.startsWith("//") ||
    candidate.includes("://") ||
    candidate.includes("?") ||
    candidate.includes("#") ||
    /[\u0000-\u001f\u007f]/.test(candidate) ||
    candidate.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }

  const path = candidate.startsWith("/") ? candidate : `/${candidate}`;
  return path === "/" ? "" : path.replace(/\/+$/, "");
}

function endpointFor(baseUrl: string, servicePath: string) {
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.replace(/\/+$/, "");
  const path = `${basePath}${servicePath}` || "/";
  return new URL(path.startsWith("/") ? path : `/${path}`, parsed.origin).toString();
}

function requestFrom(value: AlphaModelProviderRequest | { request?: AlphaModelProviderRequest } | undefined) {
  if (typeof value === "function") return value;
  return value?.request ?? fetch;
}

function runtimeEnvironment(): Readonly<Record<string, string | undefined>> {
  return typeof process === "undefined" ? {} : process.env;
}

function alphaOptionsFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  request?: AlphaModelProviderRequest,
): MedharyaAlphaProviderOptions {
  return {
    apiKey: env.MEDHARYA_ALPHA_API_KEY,
    model: env.MEDHARYA_ALPHA_MODEL,
    baseModel: env.MEDHARYA_ALPHA_BASE_MODEL,
    adapterVersion: env.MEDHARYA_ALPHA_ADAPTER_VERSION,
    baseUrl: env.MEDHARYA_ALPHA_BASE_URL,
    healthPath: env.MEDHARYA_ALPHA_HEALTH_PATH,
    chatPath: env.MEDHARYA_ALPHA_CHAT_PATH,
    timeoutMs: env.MEDHARYA_ALPHA_TIMEOUT_MS ? Number(env.MEDHARYA_ALPHA_TIMEOUT_MS) : undefined,
    maxConcurrent: env.MEDHARYA_ALPHA_MAX_CONCURRENT ? Number(env.MEDHARYA_ALPHA_MAX_CONCURRENT) : undefined,
    maxOutputTokens: env.MEDHARYA_ALPHA_MAX_OUTPUT_TOKENS ? Number(env.MEDHARYA_ALPHA_MAX_OUTPUT_TOKENS) : undefined,
    allowInsecureLocal: env.MEDHARYA_ALPHA_ALLOW_INSECURE_LOCAL,
    request,
  };
}

function normalizeAlphaConfig(options: MedharyaAlphaProviderOptions): NormalizedAlphaConfig | null {
  const apiKey = configuredValue(options.apiKey);
  const model = configuredValue(options.model);
  const allowInsecureLocal = booleanOption(options.allowInsecureLocal);
  const baseUrl = normalizeBaseUrl(options.baseUrl, allowInsecureLocal);
  const healthPath = normalizeServicePath(options.healthPath, DEFAULT_HEALTH_PATH);
  const chatPath = normalizeServicePath(options.chatPath, DEFAULT_CHAT_PATH);
  if (!apiKey || !model || !baseUrl || healthPath === null || chatPath === null) return null;

  const request = requestFrom(options.request);
  return {
    apiKey,
    model,
    ...(configuredValue(options.baseModel) ? { baseModel: configuredValue(options.baseModel) ?? undefined } : {}),
    ...(configuredValue(options.adapterVersion)
      ? { adapterVersion: configuredValue(options.adapterVersion) ?? undefined }
      : {}),
    baseUrl,
    healthPath,
    chatPath,
    timeoutMs: timeoutFor(options.timeoutMs),
    maxConcurrent: maxConcurrentFor(options.maxConcurrent),
    maxOutputTokens: maxOutputTokensFor(options.maxOutputTokens),
    allowInsecureLocal,
    request,
  };
}

function alphaOptionsFromInput(
  options: MedharyaAlphaProviderOptions | GetConfiguredMedharyaAlphaProviderOptions,
): MedharyaAlphaProviderOptions {
  if ("env" in options) {
    return alphaOptionsFromEnvironment(options.env ?? runtimeEnvironment(), options.request);
  }
  return options;
}

function createRequestId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch {
    // A request id is useful for correlation but does not need to be persisted locally.
  }
  return `alpha-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function pumpAlphaQueue() {
  while (alphaRequestQueue.length && activeAlphaRequests < alphaRequestQueue[0].limit) {
    const entry = alphaRequestQueue.shift();
    if (!entry) return;
    activeAlphaRequests += 1;
    void entry.task().then(entry.resolve, entry.reject).finally(() => {
      activeAlphaRequests -= 1;
      pumpAlphaQueue();
    });
  }
}

function runWithAlphaConcurrency<T>(limit: number, task: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    if (alphaRequestQueue.length >= MAX_QUEUED_REQUESTS) {
      reject(new AlphaQueueCapacityError());
      return;
    }

    alphaRequestQueue.push({
      limit,
      task,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    pumpAlphaQueue();
  });
}

function unavailable(reason: ProviderErrorReason, model: string | null): ModelProviderResult {
  return {
    status: "unavailable",
    provider: ALPHA_PROVIDER_ID,
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
  const history = Array.isArray(candidate?.recentMessages)
    ? candidate.recentMessages.slice(-MEDHARYA_ALPHA_LIMITS.maxHistoryMessages).map((message) => ({
        role: message?.role === "assistant" ? "assistant" : "user",
        content: boundedText(message?.content, MEDHARYA_ALPHA_LIMITS.maxHistoryMessageChars),
      }))
    : [];

  return {
    system: boundedText(candidate?.system, MEDHARYA_ALPHA_LIMITS.maxSystemChars),
    context: boundedText(candidate?.context, MEDHARYA_ALPHA_LIMITS.maxContextChars),
    history,
    message: boundedText(candidate?.userMessage, MEDHARYA_ALPHA_LIMITS.maxMessageChars),
  };
}

export function normalizeMedharyaAlphaResponse(
  value: unknown,
  maxOutputChars = MEDHARYA_ALPHA_LIMITS.maxOutputChars,
): NormalizedMedharyaAlphaResponse | null {
  if (!isRecord(value)) return null;

  const outputLimit = Number.isFinite(maxOutputChars)
    ? Math.min(Math.max(Math.floor(maxOutputChars), 1), MEDHARYA_ALPHA_LIMITS.maxOutputChars)
    : MEDHARYA_ALPHA_LIMITS.maxOutputChars;
  const text = [value.response, value.reply, value.content]
    .map((candidate) => boundedText(candidate, outputLimit))
    .find(Boolean);
  if (!text) return null;

  const model = metadataText(value.model);
  const baseModel = metadataText(value.base_model ?? value.baseModel);
  const adapterVersion = adapterMetadata(value);
  const usage = usageFromResponse(value.usage);
  return {
    text,
    ...(model ? { model } : {}),
    ...(baseModel ? { baseModel } : {}),
    ...(adapterVersion ? { adapterVersion } : {}),
    ...(usage ? { usage } : {}),
  };
}

async function requestAlphaOnce(
  config: NormalizedAlphaConfig,
  prompt: ModelPrompt,
): Promise<ModelProviderResult> {
  const safePrompt = boundedPrompt(prompt);
  const requestId = createRequestId();
  const body = JSON.stringify({
    request_id: requestId,
    message: safePrompt.message,
    system: safePrompt.system,
    context: safePrompt.context,
    history: safePrompt.history,
    max_new_tokens: config.maxOutputTokens,
  });

  if (body.length > MAX_REQUEST_CHARS) return unavailable(PROVIDER_ERROR_REASONS.invalidResponse, config.model);

  try {
    return await runWithAlphaConcurrency(config.maxConcurrent, async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await config.request(endpointFor(config.baseUrl, config.chatPath), {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
            "X-Request-ID": requestId,
          },
          body,
          signal: controller.signal,
        });

        if (!response.ok) return unavailable(reasonFromStatus(response.status), config.model);

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          return unavailable(PROVIDER_ERROR_REASONS.invalidResponse, config.model);
        }

        const normalized = normalizeMedharyaAlphaResponse(payload);
        if (!normalized) return unavailable(PROVIDER_ERROR_REASONS.invalidResponse, config.model);

        return {
          status: "available",
          text: normalized.text,
          provider: ALPHA_PROVIDER_ID,
          model: normalized.model ?? config.model,
          ...(normalized.baseModel ? { baseModel: normalized.baseModel } : {}),
          ...(normalized.adapterVersion ? { adapterVersion: normalized.adapterVersion } : {}),
          ...(normalized.usage ? { usage: normalized.usage } : {}),
        };
      } catch (error) {
        return unavailable(reasonFromRequestError(error), config.model);
      } finally {
        clearTimeout(timeout);
      }
    });
  } catch (error) {
    return unavailable(
      error instanceof AlphaQueueCapacityError ? PROVIDER_ERROR_REASONS.transientError : reasonFromRequestError(error),
      config.model,
    );
  }
}

export async function requestMedharyaAlpha(
  options: MedharyaAlphaProviderOptions,
  prompt: ModelPrompt,
  requestOrOptions?: AlphaModelProviderRequest | { request?: AlphaModelProviderRequest },
): Promise<ModelProviderResult> {
  const request = requestFrom(requestOrOptions ?? options.request);
  const config = normalizeAlphaConfig({ ...options, request });
  if (!config) return unavailable(PROVIDER_ERROR_REASONS.missingConfig, configuredValue(options.model));
  return requestAlphaOnce(config, prompt);
}

function healthState(
  state: MedharyaAlphaHealthState,
  details: Omit<MedharyaAlphaHealthStatus, "state" | "status"> = {},
): MedharyaAlphaHealthStatus {
  return { state, status: state, ...details };
}

function statusForConfiguration(options: MedharyaAlphaProviderOptions): MedharyaAlphaHealthStatus {
  return normalizeAlphaConfig(options)
    ? healthState("configured")
    : healthState("unavailable", { reason: PROVIDER_ERROR_REASONS.missingConfig });
}

function previousSuccessDetails(
  previous?: MedharyaAlphaHealthStatus | MedharyaAlphaLastSuccessMetadata,
): { lastSuccess?: MedharyaAlphaLastSuccessMetadata; lastSuccessAt?: string } {
  if (!previous) return {};
  const candidate = "state" in previous ? previous.lastSuccess : previous;
  if (!candidate || typeof candidate.checkedAt !== "string") return {};
  return { lastSuccess: candidate, lastSuccessAt: candidate.checkedAt };
}

function healthFailure(
  reason: ProviderErrorReason,
  previous: MedharyaAlphaHealthStatus | MedharyaAlphaLastSuccessMetadata | undefined,
  httpStatus?: number,
  observed?: NormalizedMedharyaAlphaResponse,
) {
  const lastSuccess = previousSuccessDetails(previous);
  const state: MedharyaAlphaHealthState = lastSuccess.lastSuccess ? "degraded" : "unavailable";
  return healthState(state, {
    reason,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(observed && (observed.model || observed.baseModel || observed.adapterVersion)
      ? {
          observed: {
            ...(observed.model ? { model: observed.model } : {}),
            ...(observed.baseModel ? { baseModel: observed.baseModel } : {}),
            ...(observed.adapterVersion ? { adapterVersion: observed.adapterVersion } : {}),
          },
        }
      : {}),
    ...lastSuccess,
  });
}

interface AlphaHealthEvaluation {
  state: "ready" | "degraded";
  reason?: ProviderErrorReason;
  observed?: NormalizedMedharyaAlphaResponse;
}

function evaluateHealthPayload(value: unknown, config: NormalizedAlphaConfig): AlphaHealthEvaluation {
  if (!isRecord(value)) return { state: "degraded", reason: PROVIDER_ERROR_REASONS.invalidResponse };

  const model = metadataText(value.model);
  const baseModel = metadataText(value.base_model ?? value.baseModel);
  const adapterVersion = adapterMetadata(value);
  const observed = { text: "", ...(model ? { model } : {}), ...(baseModel ? { baseModel } : {}), ...(adapterVersion ? { adapterVersion } : {}) };

  const rawStatus = boundedText(value.status, 48).toLowerCase().replace(/[\s-]+/g, "_");
  const ready = typeof value.ready === "boolean" ? value.ready : undefined;
  const modelLoaded = typeof value.model_loaded === "boolean"
    ? value.model_loaded
    : typeof value.modelLoaded === "boolean"
      ? value.modelLoaded
      : undefined;
  const modelLoading = typeof value.model_loading === "boolean"
    ? value.model_loading
    : typeof value.modelLoading === "boolean"
      ? value.modelLoading
      : typeof value.loading === "boolean"
        ? value.loading
        : undefined;
  const statusReady = ["ok", "ready", "healthy", "live", "up"].includes(rawStatus);
  const statusDegraded = [
    "loading",
    "model_loading",
    "starting",
    "degraded",
    "not_ready",
    "unavailable",
    "error",
    "failed",
  ].includes(rawStatus);
  const hasHealthSignal = ready !== undefined || modelLoaded !== undefined || Boolean(rawStatus) || value.ok === true || value.healthy === true;
  const explicitlyDegraded = ready === false || modelLoaded === false || modelLoading === true || statusDegraded;
  const expectedModelMismatch = Boolean(config.model && model && config.model !== model);
  const expectedBaseModelMismatch = Boolean(config.baseModel && baseModel && config.baseModel !== baseModel);
  const expectedAdapterMismatch = Boolean(config.adapterVersion && adapterVersion && config.adapterVersion !== adapterVersion);

  if (
    !hasHealthSignal ||
    explicitlyDegraded ||
    (!statusReady && ready !== true && modelLoaded !== true && value.ok !== true && value.healthy !== true) ||
    expectedModelMismatch ||
    expectedBaseModelMismatch ||
    expectedAdapterMismatch
  ) {
    return {
      state: "degraded",
      reason: PROVIDER_ERROR_REASONS.invalidResponse,
      ...(model || baseModel || adapterVersion ? { observed } : {}),
    };
  }

  return {
    state: "ready",
    ...(model || baseModel || adapterVersion ? { observed } : {}),
  };
}

export async function checkMedharyaAlphaHealth(
  options: MedharyaAlphaProviderOptions | GetConfiguredMedharyaAlphaProviderOptions,
  requestOrOptions?: AlphaModelProviderRequest | { request?: AlphaModelProviderRequest },
  previous?: MedharyaAlphaHealthStatus | MedharyaAlphaLastSuccessMetadata,
): Promise<MedharyaAlphaHealthStatus> {
  const providerOptions = alphaOptionsFromInput(options);
  const request = requestFrom(requestOrOptions ?? providerOptions.request);
  const config = normalizeAlphaConfig({ ...providerOptions, request });
  if (!config) return healthFailure(PROVIDER_ERROR_REASONS.missingConfig, previous);

  const requestId = createRequestId();
  try {
    const healthResult = await runWithAlphaConcurrency(config.maxConcurrent, async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await config.request(endpointFor(config.baseUrl, config.healthPath), {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${config.apiKey}`,
            "X-Request-ID": requestId,
          },
          signal: controller.signal,
        });

        if (!response.ok) return { response, body: undefined, bodyError: false };

        try {
          return { response, body: await response.json(), bodyError: false };
        } catch {
          return { response, body: undefined, bodyError: true };
        }
      } finally {
        clearTimeout(timeout);
      }
    });

    if (!healthResult.response.ok) {
      return healthFailure(
        reasonFromStatus(healthResult.response.status),
        previous,
        healthResult.response.status,
      );
    }
    if (healthResult.bodyError) {
      return healthFailure(PROVIDER_ERROR_REASONS.invalidResponse, previous, healthResult.response.status);
    }

    const evaluation = evaluateHealthPayload(healthResult.body, config);
    const checkedAt = new Date().toISOString();
    const observed = evaluation.observed;
    if (evaluation.state !== "ready") {
      return healthState("degraded", {
        checkedAt,
        reason: evaluation.reason ?? PROVIDER_ERROR_REASONS.invalidResponse,
        ...(observed && (observed.model || observed.baseModel || observed.adapterVersion)
          ? {
              observed: {
                ...(observed.model ? { model: observed.model } : {}),
                ...(observed.baseModel ? { baseModel: observed.baseModel } : {}),
                ...(observed.adapterVersion ? { adapterVersion: observed.adapterVersion } : {}),
              },
            }
          : {}),
        ...previousSuccessDetails(previous),
      });
    }

    const lastSuccess: MedharyaAlphaLastSuccessMetadata = {
      checkedAt,
      ...(observed?.model ? { model: observed.model } : {}),
      ...(observed?.baseModel ? { baseModel: observed.baseModel } : {}),
      ...(observed?.adapterVersion ? { adapterVersion: observed.adapterVersion } : {}),
    };
    return healthState("ready", {
      checkedAt,
      ...(observed && (observed.model || observed.baseModel || observed.adapterVersion)
        ? {
            observed: {
              ...(observed.model ? { model: observed.model } : {}),
              ...(observed.baseModel ? { baseModel: observed.baseModel } : {}),
              ...(observed.adapterVersion ? { adapterVersion: observed.adapterVersion } : {}),
            },
          }
        : {}),
      lastSuccess,
      lastSuccessAt: checkedAt,
    });
  } catch (error) {
    return healthFailure(reasonFromRequestError(error), previous);
  }
}

export function getMedharyaAlphaHealthStatus(
  options: MedharyaAlphaProviderOptions | GetConfiguredMedharyaAlphaProviderOptions = {},
): MedharyaAlphaHealthStatus {
  return statusForConfiguration(alphaOptionsFromInput(options));
}

export function createMedharyaAlphaProvider(options: MedharyaAlphaProviderOptions): MedharyaAlphaProvider {
  const model = configuredValue(options.model) ?? "";
  let currentStatus = statusForConfiguration(options);

  return {
    name: "Medharya Alpha provider",
    model,
    complete(prompt: ModelPrompt) {
      return requestMedharyaAlpha(options, prompt, options.request);
    },
    async health() {
      currentStatus = healthState("connecting", {
        ...previousSuccessDetails(currentStatus),
      });
      currentStatus = await checkMedharyaAlphaHealth(options, options.request, currentStatus);
      return currentStatus;
    },
    getHealthStatus() {
      return currentStatus;
    },
  };
}

export function getConfiguredMedharyaAlphaProvider(
  options: GetConfiguredMedharyaAlphaProviderOptions | AlphaModelProviderRequest = {},
): MedharyaAlphaProvider | null {
  const request = typeof options === "function" ? options : options.request;
  const env = typeof options === "function" ? runtimeEnvironment() : options.env ?? runtimeEnvironment();
  const providerOptions = alphaOptionsFromEnvironment(env, request);
  return normalizeAlphaConfig(providerOptions) ? createMedharyaAlphaProvider(providerOptions) : null;
}

export const createAlphaProvider = createMedharyaAlphaProvider;
export const getConfiguredAlphaProvider = getConfiguredMedharyaAlphaProvider;
export const requestAlpha = requestMedharyaAlpha;
export const normalizeAlphaResponse = normalizeMedharyaAlphaResponse;
export const checkAlphaHealth = checkMedharyaAlphaHealth;
export const getAlphaHealthStatus = getMedharyaAlphaHealthStatus;
export const getMedharyaAlphaStatus = getMedharyaAlphaHealthStatus;
