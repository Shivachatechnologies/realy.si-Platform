import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Server-side page fetch for SEO audits, hardened against SSRF: http/https only, default ports only, every hop's host
 * resolved and refused when any address is private/loopback/link-local/reserved, at most 3 redirects, 10 s total,
 * 2 MB body cap.
 */
export class AuditFetchError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4Private(ip);
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipv4Private(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("2001:db8");
  }
  return true;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AuditFetchError("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AuditFetchError("unsupported_protocol");
  if (url.username || url.password) throw new AuditFetchError("invalid_url");
  if (url.port && url.port !== "80" && url.port !== "443") throw new AuditFetchError("blocked_port");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new AuditFetchError("blocked_host");
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
    } catch {
      throw new AuditFetchError("dns_failed");
    }
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new AuditFetchError("blocked_host");
  return url;
}

export interface FetchedPage {
  finalUrl: string;
  status: number;
  html: string;
  headers: Headers;
}

export async function fetchPage(raw: string): Promise<FetchedPage> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current);
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal: deadline, headers: { "user-agent": "RealySEOAudit/1.0", accept: "text/html,application/xhtml+xml" } });
    } catch {
      throw new AuditFetchError(deadline.aborted ? "timeout" : "fetch_failed");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, url).toString();
      await res.body?.cancel().catch(() => undefined);
      continue;
    }
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html|xml/i.test(type)) {
      await res.body?.cancel().catch(() => undefined);
      throw new AuditFetchError("not_html");
    }
    if (Number(res.headers.get("content-length") ?? "0") > MAX_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      throw new AuditFetchError("too_large");
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) {
            await reader.cancel().catch(() => undefined);
            throw new AuditFetchError("too_large");
          }
          chunks.push(value);
        }
      } catch (err) {
        if (err instanceof AuditFetchError) throw err;
        throw new AuditFetchError(deadline.aborted ? "timeout" : "fetch_failed");
      }
    }
    return { finalUrl: url.toString(), status: res.status, html: Buffer.concat(chunks).toString("utf8"), headers: res.headers };
  }
  throw new AuditFetchError("too_many_redirects");
}

// ── On-page analysis ──

export interface AuditIssue {
  code: string;
  severity: "error" | "warning" | "info";
  value?: string | number;
}

export interface PageAnalysis {
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  canonical: string | null;
  robots: string | null;
  imageCount: number;
  imagesWithAlt: number;
  wordCount: number;
  internalLinks: number;
  externalLinks: number;
  issues: AuditIssue[];
  score: number;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null;
}

function metaContent(html: string, name: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if ((attr(tag, "name") ?? attr(tag, "property") ?? "").toLowerCase() === name) return attr(tag, "content");
  }
  return null;
}

export function analyzeHtml(html: string, pageUrl: string, headers?: Headers): PageAnalysis {
  const body = html.replace(/<!--[\s\S]*?-->/g, "");
  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decode(titleMatch[1]!) || null : null;
  const metaDescription = metaContent(body, "description");
  const robots = metaContent(body, "robots") ?? headers?.get("x-robots-tag") ?? null;
  const canonicalTag = (body.match(/<link\b[^>]*>/gi) ?? []).find((t) => (attr(t, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  const canonical = canonicalTag ? attr(canonicalTag, "href") : null;
  const h1Count = (body.match(/<h1\b/gi) ?? []).length;
  const images = body.match(/<img\b[^>]*>/gi) ?? [];
  const imagesWithAlt = images.filter((t) => (attr(t, "alt") ?? "").trim().length > 0).length;
  const text = decode(
    body
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
  const wordCount = text ? text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
  let internalLinks = 0;
  let externalLinks = 0;
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  for (const tag of body.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(tag, "href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    try {
      const u = new URL(href, pageUrl);
      if (u.hostname.replace(/^www\./, "") === host) internalLinks++;
      else externalLinks++;
    } catch {
      /* ignore malformed */
    }
  }

  const issues: AuditIssue[] = [];
  if (!title) issues.push({ code: "title_missing", severity: "error" });
  else if (title.length < 30) issues.push({ code: "title_short", severity: "warning", value: title.length });
  else if (title.length > 60) issues.push({ code: "title_long", severity: "warning", value: title.length });
  if (!metaDescription) issues.push({ code: "meta_description_missing", severity: "error" });
  else if (metaDescription.length < 70) issues.push({ code: "meta_description_short", severity: "warning", value: metaDescription.length });
  else if (metaDescription.length > 160) issues.push({ code: "meta_description_long", severity: "warning", value: metaDescription.length });
  if (h1Count === 0) issues.push({ code: "h1_missing", severity: "error" });
  else if (h1Count > 1) issues.push({ code: "h1_multiple", severity: "warning", value: h1Count });
  if (!canonical) issues.push({ code: "canonical_missing", severity: "warning" });
  if (robots && /noindex/i.test(robots)) issues.push({ code: "noindex", severity: "error", value: robots });
  if (images.length && imagesWithAlt < images.length) issues.push({ code: "images_missing_alt", severity: "warning", value: images.length - imagesWithAlt });
  if (wordCount < 300) issues.push({ code: "thin_content", severity: "warning", value: wordCount });
  if (internalLinks === 0) issues.push({ code: "no_internal_links", severity: "info" });
  if (!/^https:/i.test(pageUrl)) issues.push({ code: "not_https", severity: "error" });

  const penalty = issues.reduce((s, i) => s + (i.severity === "error" ? 15 : i.severity === "warning" ? 7 : 2), 0);
  return { title, metaDescription, h1Count, canonical, robots, imageCount: images.length, imagesWithAlt, wordCount, internalLinks, externalLinks, issues, score: Math.max(0, 100 - penalty) };
}
