import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { lookup as dnsLookupAsync } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import zlib from "node:zlib";
import { env } from "./env";

/**
 * Outbound requests to hosts a customer configured (workflow webhooks, Custom API, OpenAI-compatible endpoints,
 * WordPress sites, S3-compatible endpoints, Zapier / Make / n8n hooks, OIDC issuers, outbound webhook subscriptions).
 *
 * SSRF policy (docs/security.md §SSRF), enforced in production:
 *  - http(s) only (https in production), no credentials in the URL;
 *  - the host must not be a private, loopback, link-local, metadata, CGNAT, multicast or reserved address, whether it
 *    is written as a literal or what its DNS name resolves to;
 *  - the check runs at send time, on the address the socket actually connects to (the DNS lookup of the connection is
 *    replaced by a checking one, so DNS rebinding between "check" and "connect" is not possible);
 *  - redirects are never followed blindly: every hop is checked again, and credentials are dropped on a cross-origin
 *    hop.
 * Outside production the address checks are off by default (local test endpoints), the syntax checks stay on.
 */

export class OutboundBlockedError extends Error {
  readonly code = "outbound_blocked";
  constructor(message: string) {
    super(message);
    this.name = "OutboundBlockedError";
  }
}

// ───────────────────────────── Address classification ─────────────────────────────

const V4_BLOCKED: [number, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].map(([base, bits]) => [v4ToInt(base as string)!, bits as number]);

function v4ToInt(addr: string): number | null {
  const parts = addr.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function v4Blocked(n: number): boolean {
  return V4_BLOCKED.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    return n >= base && n < base + size;
  });
}

/** Expand an IPv6 address to its 8 16-bit groups (an embedded dotted IPv4 tail included); null when not IPv6. */
function v6Groups(addr: string): number[] | null {
  let a = addr.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = a.indexOf("%");
  if (zone >= 0) a = a.slice(0, zone);
  if (isIP(a) !== 6) return null;
  const tail = a.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const n = v4ToInt(tail[1]!);
    if (n === null) return null;
    a = `${a.slice(0, -tail[1]!.length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = a.split("::") as [string, string | undefined];
  const h = head ? head.split(":") : [];
  const r = rest !== undefined ? (rest ? rest.split(":") : []) : [];
  const fill = rest !== undefined ? 8 - h.length - r.length : 0;
  const groups = [...h, ...Array<string>(Math.max(0, fill)).fill("0"), ...r].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** True for every address a customer-configured request must never reach (private, loopback, link-local, metadata, reserved). */
export function isPrivateAddress(addr: string): boolean {
  const host = addr.trim().replace(/^\[|\]$/g, "");
  if (isIP(host) === 4) return v4Blocked(v4ToInt(host)!);
  const g = v6Groups(host);
  if (!g) return true; // not an IP literal at all: treat as unsafe (callers pass resolved addresses)
  const v4tail = ((g[6]! << 16) + g[7]!) >>> 0;
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(8)) return true; // ::
  if (zeroTo(7) && g[7] === 1) return true; // ::1
  if (zeroTo(5) && g[5] === 0xffff) return v4Blocked(v4tail); // ::ffff:a.b.c.d (IPv4-mapped)
  if (zeroTo(6)) return v4Blocked(v4tail); // ::a.b.c.d (IPv4-compatible, deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4Blocked(v4tail); // NAT64
  if (g[0] === 0x2002) return v4Blocked(((g[1]! << 16) + g[2]!) >>> 0); // 6to4
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0]! & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo (tunnels to arbitrary IPv4)
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 discard
  return false;
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".internal", ".local", ".localdomain", ".home.arpa", ".intranet", ".corp", ".lan"];
const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "metadata", "metadata.google.internal", "instance-data", "kubernetes.default", "kubernetes.default.svc"]);

export interface OutboundPolicy {
  /** Block private / reserved addresses (literal and resolved). Default: on in production. */
  enforce?: boolean;
  /** Allow plain http. Default: outside production only. */
  allowHttp?: boolean;
  /** Address classifier (tests use a narrower one to exercise the hop checks against a local server). */
  isBlocked?: (address: string) => boolean;
}

interface ResolvedPolicy {
  enforce: boolean;
  allowHttp: boolean;
  isBlocked: (address: string) => boolean;
}

function resolvePolicy(p: OutboundPolicy = {}): ResolvedPolicy {
  const prod = env().NODE_ENV === "production";
  return { enforce: p.enforce ?? prod, allowHttp: p.allowHttp ?? !prod, isBlocked: p.isBlocked ?? isPrivateAddress };
}

/** Syntax and literal-address check of one URL (no DNS). Throws OutboundBlockedError. */
export function assertOutboundUrl(value: string | URL, policy: OutboundPolicy = {}): URL {
  const p = resolvePolicy(policy);
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new OutboundBlockedError("Invalid URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && p.allowHttp)) throw new OutboundBlockedError("The URL must use HTTPS");
  if (url.username || url.password) throw new OutboundBlockedError("Credentials in URLs are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host) throw new OutboundBlockedError("Invalid URL");
  if (p.enforce) {
    if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) throw new OutboundBlockedError("Private network addresses are not allowed");
    if (isIP(host) && p.isBlocked(host)) throw new OutboundBlockedError("Private network addresses are not allowed");
    if (!isIP(host) && !host.includes(".")) throw new OutboundBlockedError("Private network addresses are not allowed"); // single-label intranet names
  }
  return url;
}

/** Resolve the URL's host and refuse when any address is private (send-time DNS check). No-op when not enforcing. */
export async function assertPublicTarget(value: string | URL, policy: OutboundPolicy = {}): Promise<URL> {
  const url = assertOutboundUrl(value, policy);
  const p = resolvePolicy(policy);
  if (!p.enforce) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return url; // literal: checked above
  let addrs: LookupAddress[];
  try {
    addrs = await dnsLookupAsync(host, { all: true, verbatim: true });
  } catch {
    throw new OutboundBlockedError(`${host} could not be resolved`);
  }
  if (!addrs.length || addrs.some((a) => p.isBlocked(a.address))) throw new OutboundBlockedError("target resolves to a private address");
  return url;
}

// ───────────────────────────── Guarded fetch ─────────────────────────────

export interface GuardedInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  signal?: AbortSignal | null;
  /** "follow" (default): follow up to maxRedirects, each hop checked; "manual": return the 3xx; "error": throw on a 3xx. */
  redirect?: RequestRedirect;
}

export interface GuardedOptions extends OutboundPolicy {
  maxRedirects?: number;
  /** Response body cap in bytes (default 25 MB). */
  maxBytes?: number;
  /**
   * Transport. "pinned" (default) connects with node:http(s) through a checking DNS lookup, so the checked address is
   * the connected one. "fetch" uses the global fetch with manual redirects and a send-time DNS check per hop; it is for
   * fixed provider hosts, where only redirect targets are untrusted.
   */
  transport?: "pinned" | "fetch";
  /** With transport "fetch": skip the DNS check of the first hop (the URL is a fixed provider host). */
  trustFirstHop?: boolean;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Headers kept on a cross-origin redirect; everything else (Authorization, API-key headers, cookies) is dropped. */
const CROSS_ORIGIN_SAFE = new Set(["accept", "accept-language", "user-agent", "content-type", "accept-encoding"]);
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/** The DNS lookup every pinned connection uses: refuses when any resolved address is blocked (exported for tests). */
export function checkingLookup(policy: OutboundPolicy = {}) {
  return guardedLookup(resolvePolicy(policy));
}

function guardedLookup(p: ResolvedPolicy) {
  return (hostname: string, options: { all?: boolean; family?: number | string }, callback: (...args: unknown[]) => void) => {
    dnsLookup(hostname, { family: (options.family as 0 | 4 | 6 | undefined) ?? 0, all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = addresses as LookupAddress[];
      if (p.enforce && (!list.length || list.some((a) => p.isBlocked(a.address)))) return callback(new OutboundBlockedError("target resolves to a private address"));
      if (options.all) return callback(null, list);
      return callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

async function encodeBody(body: BodyInit | null | undefined, headers: Headers): Promise<Uint8Array | undefined> {
  if (body === undefined || body === null) return undefined;
  // Let the platform encode every BodyInit (FormData boundaries, URLSearchParams, Blob types) exactly as fetch would.
  const req = new Request("http://encode.invalid/", { method: "POST", body });
  const ct = req.headers.get("content-type");
  if (ct && !headers.has("content-type")) headers.set("content-type", ct);
  return new Uint8Array(await req.arrayBuffer());
}

function decode(buf: Buffer, encoding: string | undefined): Buffer {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return zlib.gunzipSync(buf);
    case "deflate":
      try {
        return zlib.inflateSync(buf);
      } catch {
        return zlib.inflateRawSync(buf);
      }
    case "br":
      return zlib.brotliDecompressSync(buf);
    default:
      return buf;
  }
}

function pinnedSend(url: URL, method: string, headers: Headers, body: Uint8Array | undefined, signal: AbortSignal | null | undefined, p: ResolvedPolicy, maxBytes: number): Promise<Response> {
  const mod = url.protocol === "https:" ? https : http;
  const outHeaders: Record<string, string> = {};
  headers.forEach((v, k) => {
    outHeaders[k] = v;
  });
  if (!outHeaders["accept-encoding"]) outHeaders["accept-encoding"] = "gzip, deflate, br";
  if (body) outHeaders["content-length"] = String(body.byteLength);
  return new Promise<Response>((resolve, reject) => {
    const req = mod.request(
      url,
      { method, headers: outHeaders, lookup: guardedLookup(p) as never, agent: false, signal: signal ?? undefined },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy(new Error("response too large"));
            return;
          }
          chunks.push(c);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            const status = res.statusCode ?? 502;
            const raw = Buffer.concat(chunks);
            const data = method === "HEAD" ? Buffer.alloc(0) : decode(raw, res.headers["content-encoding"] as string | undefined);
            const h = new Headers();
            for (let i = 0; i < res.rawHeaders.length; i += 2) {
              const k = res.rawHeaders[i]!.toLowerCase();
              if (k === "content-encoding" || k === "content-length" || k === "transfer-encoding" || k === "connection") continue;
              h.append(k, res.rawHeaders[i + 1]!);
            }
            const noBody = status === 204 || status === 205 || status === 304 || status < 200;
            resolve(new Response(noBody ? null : new Uint8Array(data), { status: status < 200 || status > 599 ? 502 : status, statusText: res.statusMessage ?? "", headers: h }));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * fetch() for customer-configured hosts: the SSRF policy above on the first request and on every redirect hop.
 * Returns a standard Response. Throws OutboundBlockedError when a hop is refused.
 */
export async function guardedFetch(input: string | URL, init: GuardedInit = {}, options: GuardedOptions = {}): Promise<Response> {
  const p = resolvePolicy(options);
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const transport = options.transport ?? "pinned";
  let url = assertOutboundUrl(input, options);
  let method = (init.method ?? "GET").toUpperCase();
  let headers = new Headers(init.headers);
  let body = await encodeBody(init.body, headers);
  for (let hop = 0; ; hop++) {
    if (hop > 0) url = assertOutboundUrl(url, options);
    let res: Response;
    if (transport === "pinned") {
      res = await pinnedSend(url, method, headers, body, init.signal, p, maxBytes);
    } else {
      if (!(hop === 0 && options.trustFirstHop)) await assertPublicTarget(url, options);
      res = await fetch(hop === 0 ? String(input) : url.href, { method, headers, body: body as BodyInit | undefined, signal: init.signal ?? undefined, redirect: "manual" });
    }
    if (!REDIRECTS.has(res.status) || init.redirect === "manual") return res;
    if (init.redirect === "error") {
      await res.body?.cancel().catch(() => undefined);
      throw new OutboundBlockedError(`redirects are not allowed (HTTP ${res.status})`);
    }
    const location = res.headers.get("location");
    if (!location) return res;
    await res.body?.cancel().catch(() => undefined);
    if (hop >= maxRedirects) throw new OutboundBlockedError("too many redirects");
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new OutboundBlockedError("invalid redirect location");
    }
    if (next.origin !== url.origin) {
      const kept = new Headers();
      headers.forEach((v, k) => {
        if (CROSS_ORIGIN_SAFE.has(k)) kept.set(k, v);
      });
      headers = kept;
    }
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      if (method !== "HEAD") method = "GET";
      body = undefined;
      headers.delete("content-type");
    }
    url = next;
  }
}
