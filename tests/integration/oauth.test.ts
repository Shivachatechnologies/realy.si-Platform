import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/server/core/db";
import { redis } from "@/server/core/rate-limit";
import { setOAuthForTests, OAUTH_COOKIE } from "@/server/modules/auth/oauth";
import { validateSessionToken } from "@/server/modules/auth/session";
import { GET as startRoute } from "@/app/api/v1/auth/oauth/[provider]/start/route";
import { GET as callbackRoute } from "@/app/api/v1/auth/oauth/[provider]/callback/route";
import { makeUser, resetDb } from "../helpers";

const CREDS = { clientId: "client-id", clientSecret: "client-secret" };
type Profile = { sub: string; email: string | null; verified: boolean; name?: string };

let profile: Profile;
let lastTokenRequest: URLSearchParams | null = null;

/** HTTP double for provider token + identity endpoints. */
const providerFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (/token$|access_token$/.test(url)) {
    lastTokenRequest = new URLSearchParams(String(init?.body));
    return lastTokenRequest.get("code") === "good-code" ? json({ access_token: "provider-access-token" }) : json({ error: "invalid_grant" }, 400);
  }
  if (url.includes("openidconnect.googleapis.com")) return json({ sub: profile.sub, email: profile.email, email_verified: profile.verified, name: profile.name });
  if (url.includes("graph.microsoft.com")) return json({ sub: profile.sub, email: profile.email, name: profile.name });
  if (url.endsWith("api.github.com/user")) return json({ id: Number(profile.sub), login: "octo", name: profile.name });
  if (url.endsWith("api.github.com/user/emails")) return json(profile.email ? [{ email: profile.email, primary: true, verified: profile.verified }] : []);
  return json({}, 404);
}) as typeof fetch;

const ctxOf = (provider: string) => ({ params: Promise.resolve({ provider }) });

function get(path: string, cookies: Record<string, string> = {}) {
  const headers = new Headers({ host: "localhost:3000", "x-forwarded-for": "192.0.2.200" });
  const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (c) headers.set("cookie", c);
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

const cookieValue = (res: Response, name: string) => {
  const all = res.headers.getSetCookie();
  const hit = all.find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.split(";")[0]!.slice(name.length + 1)) : null;
};

/** Run start → provider redirect → callback, returning the final redirect. */
async function flow(provider: string, opts: { mode?: "login" | "link"; session?: string; code?: string; tamperState?: boolean } = {}) {
  const startRes = await startRoute(get(`/api/v1/auth/oauth/${provider}/start?locale=de-DE&mode=${opts.mode ?? "login"}`, opts.session ? { realy_session: opts.session } : {}), ctxOf(provider) as never);
  const location = new URL(startRes.headers.get("location")!);
  const state = location.searchParams.get("state");
  const stateCookie = cookieValue(startRes, OAUTH_COOKIE);
  const cookies: Record<string, string> = { [OAUTH_COOKIE]: stateCookie ?? "" };
  if (opts.session) cookies.realy_session = opts.session;
  const cb = await callbackRoute(get(`/api/v1/auth/oauth/${provider}/callback?code=${opts.code ?? "good-code"}&state=${opts.tamperState ? "forged" : state}`, cookies), ctxOf(provider) as never);
  return { startRes, location, cb, redirect: new URL(cb.headers.get("location")!), session: cookieValue(cb, "realy_session") };
}

beforeAll(resetDb);
beforeEach(async () => {
  const keys = await redis().keys("rl:*");
  if (keys.length) await redis().del(...keys);
});
afterEach(() => setOAuthForTests(undefined));

describe("OAuth not configured", () => {
  it("redirects back with not_configured and never contacts a provider", async () => {
    setOAuthForTests({}, providerFetch);
    const res = await startRoute(get("/api/v1/auth/oauth/google/start?locale=en-US"), ctxOf("google") as never);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/en-US/sign-in?oauthError=not_configured&provider=google");
    expect(cookieValue(res, OAUTH_COOKIE)).toBeNull();
  });
});

describe("OAuth configured", () => {
  beforeEach(() => setOAuthForTests({ google: CREDS, github: CREDS, microsoft: CREDS }, providerFetch));

  it("uses state + PKCE S256 with an encrypted HttpOnly cookie, and creates a verified account", async () => {
    profile = { sub: "g-1001", email: "New.Person@Example.test", verified: true, name: "New Person" };
    const { startRes, location, redirect, session } = await flow("google");
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/v1/auth/oauth/google/callback");
    const setCookie = startRes.headers.getSetCookie().find((c) => c.startsWith(OAUTH_COOKIE))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).not.toContain(location.searchParams.get("state")!); // encrypted, not the raw state
    // PKCE: verifier sent to the token endpoint hashes to the challenge sent to the browser.
    const verifier = lastTokenRequest!.get("code_verifier")!;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(location.searchParams.get("code_challenge"));

    expect(redirect.pathname).toBe("/de-DE/onboarding");
    const s = await validateSessionToken(session);
    const user = await db().user.findUniqueOrThrow({ where: { id: s!.userId } });
    expect(user.email).toBe("new.person@example.test");
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.passwordHash).toBeNull();
    expect(user.locale).toBe("de-DE");

    const again = await flow("google");
    expect(again.redirect.pathname).toBe("/de-DE");
    expect((await validateSessionToken(again.session))!.userId).toBe(user.id);
    expect(await db().user.count({ where: { email: "new.person@example.test" } })).toBe(1);
  });

  it("rejects forged state, a missing state cookie and failed code exchange", async () => {
    profile = { sub: "g-2002", email: "x2@example.test", verified: true };
    expect((await flow("google", { tamperState: true })).redirect.search).toContain("oauthError=state_mismatch");
    const noCookie = await callbackRoute(get("/api/v1/auth/oauth/google/callback?code=good-code&state=abc"), ctxOf("google") as never);
    expect(noCookie.headers.get("location")).toContain("oauthError=state_mismatch");
    expect((await flow("google", { code: "bad-code" })).redirect.search).toContain("oauthError=provider_error");
    expect(await db().user.count({ where: { email: "x2@example.test" } })).toBe(0);
  });

  it("never auto-links to an existing account with the same email (takeover protection)", async () => {
    const existing = await makeUser();
    profile = { sub: "g-3003", email: existing.user.email, verified: true };
    const { redirect, session } = await flow("google");
    expect(redirect.search).toContain("oauthError=account_exists");
    expect(session).toBeNull();
    expect(await db().oAuthAccount.count({ where: { userId: existing.user.id } })).toBe(0);
  });

  it("does not create accounts from unverified emails; Microsoft emails are never trusted", async () => {
    profile = { sub: "g-4004", email: "unverified@example.test", verified: false };
    expect((await flow("google")).redirect.search).toContain("oauthError=email_unverified");
    profile = { sub: "ms-4005", email: "ms-user@example.test", verified: true };
    expect((await flow("microsoft")).redirect.search).toContain("oauthError=email_unverified");
    expect(await db().user.count({ where: { email: { in: ["unverified@example.test", "ms-user@example.test"] } } })).toBe(0);
  });

  it("links a provider to the signed-in account, then signs in with it; MFA still applies", async () => {
    const { signUp } = await import("@/server/modules/auth/service");
    const { systemContext } = await import("@/server/core/context");
    const reg = await signUp(systemContext(), { email: "linker@example.test", password: "a-very-long-password", name: "Linker" });
    profile = { sub: "ms-5005", email: "spoofable@example.test", verified: false };
    const linked = await flow("microsoft", { mode: "link", session: reg.token });
    expect(linked.redirect.pathname).toBe("/de-DE/settings/security");
    expect(linked.redirect.search).toBe("?oauth=linked");
    expect(await db().oAuthAccount.count({ where: { userId: reg.session.userId, provider: "microsoft" } })).toBe(1);

    await db().user.update({ where: { id: reg.session.userId }, data: { mfaEnabled: true } });
    const login = await flow("microsoft");
    expect(login.redirect.pathname).toBe("/de-DE/mfa");
    expect((await validateSessionToken(login.session))!.mfaPending).toBe(true);
  });

  it("refuses to link an identity that belongs to another account", async () => {
    profile = { sub: "777", email: "gh-owner@example.test", verified: true };
    await flow("github"); // creates the account that owns GitHub identity 777
    const { signUp } = await import("@/server/modules/auth/service");
    const { systemContext } = await import("@/server/core/context");
    const other = await signUp(systemContext(), { email: "other@example.test", password: "a-very-long-password", name: "Other" });
    const res = await flow("github", { mode: "link", session: other.token });
    expect(res.redirect.search).toContain("oauthError=already_linked");
  });

  it("link mode requires a signed-in session", async () => {
    const res = await startRoute(get("/api/v1/auth/oauth/google/start?locale=en-US&mode=link"), ctxOf("google") as never);
    expect(res.headers.get("location")).toBe("http://localhost:3000/en-US/sign-in");
  });
});
