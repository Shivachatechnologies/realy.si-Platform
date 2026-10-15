/**
 * Centralized security headers (docs/security.md §4). Used by next.config.ts (static headers),
 * src/proxy.ts (per-request nonce CSP for HTML) and tests.
 */

export const STATIC_SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

export const HSTS = { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" };

/** JSON API responses never render HTML: deny everything. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * HTML CSP with a per-request nonce. Scripts: only nonce-bearing scripts (and what they load, via
 * 'strict-dynamic') — no 'unsafe-inline'. Documented exception: style-src allows 'unsafe-inline'
 * because server-rendered style attributes (font variables, Radix positioning) cannot carry nonces;
 * style injection is a far weaker vector than script injection.
 */
export function buildCsp(nonce: string, opts: { dev: boolean }): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${opts.dev ? " ws: wss:" : ""}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(opts.dev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

/** 128-bit random nonce, base64 (Web Crypto: available in the proxy runtime). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
