/**
 * Post-auth redirect target from `?next=`. Only same-site, locale-prefixed paths are accepted
 * (no scheme, no host, no "//", no backslashes), so this can never become an open redirect.
 */
const SAFE_NEXT = /^\/[a-z]{2}-[A-Z]{2}(\/[A-Za-z0-9\-_/]*)?$/;

export function safeNext(candidate: string | null | undefined, fallback: string): string {
  if (!candidate) return fallback;
  return SAFE_NEXT.test(candidate) && !candidate.includes("//") ? candidate : fallback;
}

export function nextFromLocation(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return safeNext(new URLSearchParams(window.location.search).get("next"), fallback);
}

/** Read a one-time token from the URL fragment, then remove it from the address bar and history. */
export function takeFragmentToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (token) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return token;
}
