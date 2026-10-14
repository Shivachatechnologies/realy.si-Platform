import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { redis, resetMemoryLimiter } from "@/server/core/rate-limit";
import { clientIpFrom } from "@/server/core/http";
import { purgeExpiredIdempotencyKeys } from "@/server/core/idempotency";
import { POST as signUpRoute } from "@/app/api/v1/auth/sign-up/route";
import { POST as signInRoute } from "@/app/api/v1/auth/sign-in/route";
import { POST as mfaVerifyRoute } from "@/app/api/v1/auth/mfa/verify/route";
import { POST as createOrgRoute } from "@/app/api/v1/organizations/route";
import { GET as pricingRoute } from "@/app/api/v1/catalog/pricing/route";
import { beginTotpSetup, confirmTotpSetup } from "@/server/modules/auth/service";
import { currentStep, hotp } from "@/server/modules/auth/totp";
import { userContext } from "@/server/core/context";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { makeUser, resetDb } from "../helpers";
import { noParams, req, sessionCookie } from "../http";

beforeAll(resetDb);
beforeEach(async () => {
  const keys = await redis().keys("rl:*");
  if (keys.length) await redis().del(...keys);
  resetMemoryLimiter();
});

async function signUp(email: string) {
  const res = await signUpRoute(req("/api/v1/auth/sign-up", { body: { email, password: "a-very-long-password", name: "T" }, xff: `10.0.0.${Math.floor(Math.random() * 250)}` }), noParams);
  expect(res.status).toBe(200);
  return sessionCookie(res);
}

describe("trusted client IP", () => {
  it("uses the entry appended by the trusted proxy, never the client-supplied left-most value", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(clientIpFrom(h, 1)).toBe("203.0.113.9");
    expect(clientIpFrom(h, 2)).toBe("6.6.6.6");
    expect(clientIpFrom(h, 0)).toBeNull();
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "not-an-ip" }), 1)).toBeNull();
  });
});

describe("rate limiting", () => {
  it("per-account sign-in limit holds even when the attacker rotates IPs, with RateLimit headers", async () => {
    await signUp("victim@example.test");
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await signInRoute(req("/api/v1/auth/sign-in", { body: { email: "Victim@Example.test", password: "wrong-password-x" }, xff: `198.51.100.${i}` }), noParams);
      if (i < 10) expect(last.status).toBe(401);
    }
    expect(last!.status).toBe(429);
    expect((await last!.json()).error.code).toBe("rate_limited");
    expect(last!.headers.get("ratelimit-limit")).toBe("10");
    expect(last!.headers.get("ratelimit-remaining")).toBe("0");
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("spoofing the left-most X-Forwarded-For does not escape the per-IP limit", async () => {
    let limited = false;
    for (let i = 0; i < 25 && !limited; i++) {
      const res = await signInRoute(
        req("/api/v1/auth/sign-in", { body: { email: `nobody${i}@example.test`, password: "x" }, xff: `1.2.3.${i}, 203.0.113.50` }),
        noParams,
      );
      limited = res.status === 429;
      if (i < 20) expect(res.status).toBe(401);
    }
    expect(limited).toBe(true);
  });

  it("public endpoints are limited per IP and report remaining quota", async () => {
    const res = await pricingRoute(req("/api/v1/catalog/pricing?country=US", { xff: "192.0.2.77" }), noParams);
    expect(res.status).toBe(200);
    expect(res.headers.get("ratelimit-limit")).toBe("120");
    expect(res.headers.get("ratelimit-remaining")).toBe("119");
  });
});

describe("request limits", () => {
  it("rejects oversized bodies with 413 before parsing", async () => {
    const res = await signUpRoute(req("/api/v1/auth/sign-up", { rawBody: JSON.stringify({ name: "x".repeat(70_000) }) }), noParams);
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("payload_too_large");
  });
});

describe("idempotency keys", () => {
  it("same key + same request replays the same result without a second mutation", async () => {
    const cookie = await signUp("idem@example.test");
    const send = () => createOrgRoute(req("/api/v1/organizations", { cookie, body: { name: "Idem Co" }, idempotencyKey: "create-org-0001" }), noParams);
    const a = await send();
    const b = await send();
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect((await a.json()).id).toBe((await b.json()).id);
    expect(await db().organization.count({ where: { name: "Idem Co" } })).toBe(1);
  });

  it("same key + different payload is rejected and nothing is created", async () => {
    const cookie = await signUp("idem2@example.test");
    await createOrgRoute(req("/api/v1/organizations", { cookie, body: { name: "First" }, idempotencyKey: "create-org-0002" }), noParams);
    const res = await createOrgRoute(req("/api/v1/organizations", { cookie, body: { name: "Second" }, idempotencyKey: "create-org-0002" }), noParams);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("idempotency_conflict");
    expect(await db().organization.count({ where: { name: "Second" } })).toBe(0);
  });

  it("concurrent duplicates create exactly one resource", async () => {
    const cookie = await signUp("idem3@example.test");
    const send = () => createOrgRoute(req("/api/v1/organizations", { cookie, body: { name: "Race Co" }, idempotencyKey: "create-org-0003" }), noParams);
    const results = await Promise.all([send(), send(), send()]);
    for (const r of results) expect([200, 409]).toContain(r.status);
    expect(await db().organization.count({ where: { name: "Race Co" } })).toBe(1);
  });

  it("keys are scoped per principal, failed requests release the key, and expired keys are purged", async () => {
    const c1 = await signUp("idem4@example.test");
    const c2 = await signUp("idem5@example.test");
    const k = "shared-key-0004";
    const a = await createOrgRoute(req("/api/v1/organizations", { cookie: c1, body: { name: "P1" }, idempotencyKey: k }), noParams);
    const b = await createOrgRoute(req("/api/v1/organizations", { cookie: c2, body: { name: "P1" }, idempotencyKey: k }), noParams);
    expect((await a.json()).id).not.toBe((await b.json()).id);

    const bad = await createOrgRoute(req("/api/v1/organizations", { cookie: c1, body: { name: "" }, idempotencyKey: "retry-after-fix-01" }), noParams);
    expect(bad.status).toBe(400);
    const fixed = await createOrgRoute(req("/api/v1/organizations", { cookie: c1, body: { name: "" }, idempotencyKey: "retry-after-fix-01" }), noParams);
    expect(fixed.status).toBe(400); // not replayed as success, not stuck "in progress"

    await db().idempotencyKey.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await purgeExpiredIdempotencyKeys()).toBeGreaterThan(0);
  });

  it("rejects malformed keys", async () => {
    const cookie = await signUp("idem6@example.test");
    const res = await createOrgRoute(req("/api/v1/organizations", { cookie, body: { name: "X" }, idempotencyKey: "short" }), noParams);
    expect(res.status).toBe(400);
  });
});

describe("MFA brute-force protection", () => {
  it("locks the pending session after 5 wrong codes, and the audit trail records every failure", async () => {
    const cookie = await signUp("mfa-cap@example.test");
    const user = await db().user.findUniqueOrThrow({ where: { email: "mfa-cap@example.test" } });
    const s = await db().session.findFirstOrThrow({ where: { userId: user.id } });
    const { secret } = await beginTotpSetup(userContext(user.id), user.id);
    await confirmTotpSetup(userContext(user.id), s.id, user.id, hotp(secret, currentStep()));
    expect(cookie).toBeTruthy();

    const login = await signInRoute(req("/api/v1/auth/sign-in", { body: { email: "mfa-cap@example.test", password: "a-very-long-password" }, xff: "192.0.2.10" }), noParams);
    const pending = sessionCookie(login);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await mfaVerifyRoute(req("/api/v1/auth/mfa/verify", { cookie: pending, body: { code: "000000" }, xff: `192.0.2.${20 + i}` }), noParams);
      statuses.push(r.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401]);
    // Even the correct code no longer works: the session was revoked.
    const r = await mfaVerifyRoute(req("/api/v1/auth/mfa/verify", { cookie: pending, body: { code: hotp(secret, currentStep() + 1n) } }), noParams);
    expect(r.status).toBe(401);
    expect(await db().auditLog.count({ where: { action: "auth.mfa_failed", actorId: user.id } })).toBe(4);
    expect(await db().auditLog.count({ where: { action: "auth.mfa_locked", actorId: user.id } })).toBe(1);
  });
});

describe("database-level tenant consistency", () => {
  it("refuses a workspace or project that points at another organization's company", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const orgA = await createOrganization(a.ctx, { name: "Org A" });
    const orgB = await createOrganization(b.ctx, { name: "Org B" });
    const companyA = await createCompany(a.ctx, orgA.id, { name: "Company A" });
    await expect(
      db().workspace.create({ data: { organizationId: orgB.id, companyId: companyA.id, name: "Smuggled", slug: "smuggled" } }),
    ).rejects.toThrow();
    const wsA = await db().workspace.findFirstOrThrow({ where: { companyId: companyA.id } });
    await expect(
      db().project.create({ data: { organizationId: orgB.id, companyId: companyA.id, workspaceId: wsA.id, name: "Smuggled" } }),
    ).rejects.toThrow();
  });
});
