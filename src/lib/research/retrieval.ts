import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_PAGE_BYTES = 1_500_000;
export const MAX_PAGE_CHARS = 18_000;
export const MAX_PAGE_REDIRECTS = 2;
export const PAGE_TIMEOUT_MS = 8_000;

export class PageRetrievalError extends Error {
  constructor(
    public readonly code:
      | "invalid-url"
      | "blocked-host"
      | "dns-failed"
      | "too-many-redirects"
      | "unsupported-content"
      | "too-large"
      | "http-error"
      | "timeout"
      | "unreadable",
    message: string,
  ) {
    super(message);
    this.name = "PageRetrievalError";
  }
}

export interface RetrievedPage {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  text: string;
  contentType: string;
  wordCount: number;
}

export type HostResolver = (hostname: string) => Promise<string[]>;
export type PageFetcher = (input: string, init?: RequestInit) => Promise<Response>;

function defaultResolveHost(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true }).then((records) => records.map((record) => record.address));
}

function privateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168 || first === 100 && second >= 64 && second <= 127;
}

function privateIpv6(address: string) {
  const normalized = address.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("::ffff:")) return privateIpv4(normalized.slice(7));
  return false;
}

function privateAddress(address: string) {
  return isIP(address) === 4 ? privateIpv4(address) : isIP(address) === 6 ? privateIpv6(address) : true;
}

function parseHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || !url.hostname) {
      throw new PageRetrievalError("invalid-url", "Only credential-free HTTP(S) URLs can be retrieved.");
    }
    return url;
  } catch (error) {
    if (error instanceof PageRetrievalError) throw error;
    throw new PageRetrievalError("invalid-url", "The research result URL is invalid.");
  }
}

export async function assertSafePublicUrl(value: string, resolveHost: HostResolver = defaultResolveHost) {
  const url = parseHttpUrl(value);
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new PageRetrievalError("blocked-host", "Local and internal hosts are not eligible for page retrieval.");
  }

  const addresses = isIP(hostname) ? [hostname] : await resolveHost(hostname).catch(() => {
    throw new PageRetrievalError("dns-failed", "The research result host could not be resolved safely.");
  });
  if (!addresses.length || addresses.some(privateAddress)) {
    throw new PageRetrievalError("blocked-host", "The research result resolves to a private or reserved network.");
  }
  return url;
}

function contentTypeAllowed(value: string) {
  const normalized = value.toLowerCase();
  return normalized.startsWith("text/html") || normalized.startsWith("application/xhtml+xml") || normalized.startsWith("text/plain");
}

async function bodyBytes(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PAGE_BYTES) {
    throw new PageRetrievalError("too-large", "The public page is larger than the retrieval limit.");
  }
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_PAGE_BYTES) throw new PageRetrievalError("too-large", "The public page is larger than the retrieval limit.");
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw new PageRetrievalError("too-large", "The public page is larger than the retrieval limit.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function decodeText(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function pageTitle(html: string, fallback: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match ? decodeEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "";
  return title.slice(0, 200) || fallback;
}

export function extractReadableText(raw: string, contentType: string) {
  const isHtml = contentType.toLowerCase().includes("html");
  const withoutNoise = isHtml
    ? raw.replace(/<(script|style|noscript|template|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ")
    : raw;
  return decodeEntities(withoutNoise).replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_CHARS);
}

export async function retrievePublicPage(
  value: string,
  options: { fetcher?: PageFetcher; resolveHost?: HostResolver; timeoutMs?: number } = {},
): Promise<RetrievedPage> {
  const fetcher = options.fetcher ?? fetch;
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? PAGE_TIMEOUT_MS, 1_000), 20_000);
  const requestedUrl = (await assertSafePublicUrl(value, resolveHost)).toString();
  let currentUrl = requestedUrl;

  for (let redirect = 0; redirect <= MAX_PAGE_REDIRECTS; redirect += 1) {
    const safeUrl = await assertSafePublicUrl(currentUrl, resolveHost);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetcher(safeUrl.toString(), {
        method: "GET",
        headers: { Accept: "text/html, application/xhtml+xml, text/plain;q=0.9" },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof PageRetrievalError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new PageRetrievalError("timeout", "The public page retrieval timed out.");
      throw new PageRetrievalError("unreadable", "The public page could not be retrieved.");
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new PageRetrievalError("http-error", "The public page returned a redirect without a location.");
      if (redirect === MAX_PAGE_REDIRECTS) throw new PageRetrievalError("too-many-redirects", "The public page redirected too many times.");
      currentUrl = new URL(location, safeUrl).toString();
      continue;
    }
    if (!response.ok) throw new PageRetrievalError("http-error", `The public page returned HTTP ${response.status}.`);

    const contentType = response.headers.get("content-type")?.split(";")[0].trim() || "";
    if (!contentTypeAllowed(contentType)) throw new PageRetrievalError("unsupported-content", "The research result is not a readable HTML or text page.");
    const rawText = decodeText(await bodyBytes(response));
    const text = extractReadableText(rawText, contentType);
    if (!text) throw new PageRetrievalError("unreadable", "The public page did not contain readable text.");
    return {
      requestedUrl,
      finalUrl: safeUrl.toString(),
      title: pageTitle(rawText, safeUrl.hostname),
      text,
      contentType,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  }

  throw new PageRetrievalError("too-many-redirects", "The public page redirected too many times.");
}
