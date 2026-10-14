import { describe, expect, it } from "vitest";
import { API_CSP, buildCsp, newNonce, STATIC_SECURITY_HEADERS } from "@/server/core/security-headers";
import { scrub, sentryBeforeSend } from "@/server/core/telemetry";
import { safeNext } from "@/lib/safe-next";

describe("content security policy", () => {
  it("production CSP allows only nonce scripts (no unsafe-inline/eval) and denies framing/plugins", () => {
    const csp = buildCsp("abc123", { dev: false });
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(scriptSrc).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(scriptSrc).not.toMatch(/unsafe/);
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "upgrade-insecure-requests"]) expect(csp).toContain(d);
  });

  it("dev CSP adds only what the dev server needs", () => {
    const csp = buildCsp("n", { dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("nonces are 128-bit and unique", () => {
    const a = newNonce();
    expect(Buffer.from(a, "base64")).toHaveLength(16);
    expect(new Set(Array.from({ length: 200 }, newNonce)).size).toBe(200);
  });

  it("API responses deny everything and static headers are present", () => {
    expect(API_CSP).toContain("default-src 'none'");
    expect(STATIC_SECURITY_HEADERS.map((h) => h.key)).toEqual(expect.arrayContaining(["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy"]));
  });
});

describe("telemetry scrubbing", () => {
  it("drops secrets and personal data, keeps operational attributes", () => {
    const out = scrub({ password: "p", accessToken: "t", "user.email": "a@b.c", code: "123456", cookie: "x", "http.status_code": 200, route: "POST /x", nested: { a: 1 } });
    expect(out).toEqual({ "http.status_code": 200, route: "POST /x" });
  });

  it("Sentry events lose request data and user identity", () => {
    const e = sentryBeforeSend({ request: { headers: { cookie: "realy_session=x" } }, user: { email: "a@b.c" }, extra: { token: "t", route: "/x" } });
    expect(e.request).toBeUndefined();
    expect(e.user).toBeUndefined();
    expect(e.extra).toEqual({ route: "/x" });
  });
});

describe("post-auth redirect safety", () => {
  it("accepts only same-site locale paths", () => {
    expect(safeNext("/en-US/invite", "/x")).toBe("/en-US/invite");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/en-US//evil", "javascript:alert(1)", "/en-US/x?y=1", "en-US/x"]) {
      expect(safeNext(bad, "/fallback")).toBe("/fallback");
    }
  });
});
