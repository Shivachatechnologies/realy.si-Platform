import { createHash } from "node:crypto";
import { db, transaction } from "@/server/core/db";
import { env } from "@/server/core/env";
import { decryptSecret, encryptSecret, randomToken, safeEqual } from "@/server/core/crypto";
import type { RequestContext } from "@/server/core/context";
import { securityEvent } from "@/server/core/telemetry";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { closestLocale } from "@/i18n/config";
import { createSession } from "./session";

/**
 * OAuth 2.0 / OIDC sign-in (docs/security.md §2). Authorization-code flow with PKCE (S256) and a
 * random `state`, both kept in an encrypted, HttpOnly, 10-minute cookie. Tokens are exchanged
 * server-side and identity is read from the provider over TLS; provider tokens are never stored.
 *
 * Account-linking policy (prevents takeover and pre-account-hijacking):
 *  - a provider identity signs in only to the account it is linked to;
 *  - an email that already belongs to a Realy account is NEVER auto-linked — the user signs in and links
 *    from Settings → Security;
 *  - a new account is created only from a provider-verified email. Microsoft's `email` claim is not
 *    verified for many tenants ("nOAuth"), so Microsoft never creates accounts by email.
 */
export const OAUTH_PROVIDERS = ["google", "github", "microsoft"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];
export const isOAuthProvider = (v: string): v is OAuthProviderId => (OAUTH_PROVIDERS as readonly string[]).includes(v);

export const OAUTH_COOKIE = "realy_oauth";
const STATE_TTL_MS = 10 * 60 * 1000;
const PURPOSE = "oauth.state";

export interface ProviderIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

interface ProviderDef {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  identity(accessToken: string, f: typeof fetch): Promise<ProviderIdentity>;
}

interface Credentials {
  clientId: string;
  clientSecret: string;
}

async function getJson(f: typeof fetch, url: string, accessToken: string): Promise<Record<string, unknown>> {
  const res = await f(url, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "user-agent": "Realy" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new OAuthError("provider_error", `identity request failed (${res.status})`);
  return (await res.json()) as Record<string, unknown>;
}

function defs(): Record<OAuthProviderId, ProviderDef> {
  const tenant = env().OAUTH_MICROSOFT_TENANT;
  return {
    google: {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
      async identity(token, f) {
        const u = await getJson(f, "https://openidconnect.googleapis.com/v1/userinfo", token);
        return { subject: String(u.sub), email: typeof u.email === "string" ? u.email : null, emailVerified: u.email_verified === true, name: typeof u.name === "string" ? u.name : null };
      },
    },
    github: {
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scope: "read:user user:email",
      async identity(token, f) {
        const u = await getJson(f, "https://api.github.com/user", token);
        const res = await f("https://api.github.com/user/emails", { headers: { authorization: `Bearer ${token}`, accept: "application/json", "user-agent": "Realy" }, signal: AbortSignal.timeout(10_000) });
        const emails = res.ok ? ((await res.json()) as { email: string; primary: boolean; verified: boolean }[]) : [];
        const primary = emails.find((e) => e.primary && e.verified);
        return { subject: String(u.id), email: primary?.email ?? null, emailVerified: !!primary, name: typeof u.name === "string" ? u.name : typeof u.login === "string" ? u.login : null };
      },
    },
    microsoft: {
      authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      scope: "openid email profile",
      async identity(token, f) {
        const u = await getJson(f, "https://graph.microsoft.com/oidc/userinfo", token);
        // Deliberately unverified: see policy above.
        return { subject: String(u.sub), email: typeof u.email === "string" ? u.email : null, emailVerified: false, name: typeof u.name === "string" ? u.name : null };
      },
    },
  };
}

let credentialsOverride: Partial<Record<OAuthProviderId, Credentials | null>> | undefined;
let fetchOverride: typeof fetch | undefined;

/** Test hooks: inject provider credentials and an HTTP double. undefined restores env/global fetch. */
export function setOAuthForTests(creds: Partial<Record<OAuthProviderId, Credentials | null>> | undefined, f?: typeof fetch) {
  credentialsOverride = creds;
  fetchOverride = f;
}

export function oauthCredentials(p: OAuthProviderId): Credentials | null {
  if (credentialsOverride !== undefined) return credentialsOverride[p] ?? null;
  const e = env();
  const pair = {
    google: [e.OAUTH_GOOGLE_CLIENT_ID, e.OAUTH_GOOGLE_CLIENT_SECRET],
    github: [e.OAUTH_GITHUB_CLIENT_ID, e.OAUTH_GITHUB_CLIENT_SECRET],
    microsoft: [e.OAUTH_MICROSOFT_CLIENT_ID, e.OAUTH_MICROSOFT_CLIENT_SECRET],
  }[p];
  return pair[0] && pair[1] ? { clientId: pair[0], clientSecret: pair[1] } : null;
}

export const oauthStatus = () => OAUTH_PROVIDERS.map((id) => ({ id, configured: oauthCredentials(id) !== null }));

export class OAuthError extends Error {
  constructor(
    readonly code: "not_configured" | "state_mismatch" | "provider_error" | "account_exists" | "email_unverified" | "already_linked" | "account_disabled",
    message: string,
  ) {
    super(message);
  }
}

interface StatePayload {
  provider: OAuthProviderId;
  state: string;
  verifier: string;
  mode: "login" | "link";
  userId: string | null;
  locale: string;
  next: string | null;
  exp: number;
}

export const redirectUri = (p: OAuthProviderId) => `${env().APP_URL}/api/v1/auth/oauth/${p}/callback`;
const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Build the provider authorization URL and the encrypted state cookie value. */
export function beginOAuth(p: OAuthProviderId, opts: { mode: "login" | "link"; userId: string | null; locale: string; next: string | null }) {
  const creds = oauthCredentials(p);
  if (!creds) throw new OAuthError("not_configured", "OAuth provider not configured.");
  const def = defs()[p];
  const payload: StatePayload = { provider: p, state: randomToken(32), verifier: randomToken(48), mode: opts.mode, userId: opts.userId, locale: closestLocale(opts.locale), next: opts.next, exp: Date.now() + STATE_TTL_MS };
  const url = new URL(def.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri(p),
    response_type: "code",
    scope: def.scope,
    state: payload.state,
    code_challenge: challengeOf(payload.verifier),
    code_challenge_method: "S256",
    ...(p === "google" ? { prompt: "select_account" } : {}),
  }).toString();
  return { url: url.toString(), cookie: encryptSecret(JSON.stringify(payload), PURPOSE), maxAgeSeconds: STATE_TTL_MS / 1000 };
}

export function readStateCookie(value: string | undefined, provider: OAuthProviderId, state: string | null): StatePayload {
  if (!value || !state) throw new OAuthError("state_mismatch", "missing state");
  let payload: StatePayload;
  try {
    payload = JSON.parse(decryptSecret(value, PURPOSE)) as StatePayload;
  } catch {
    throw new OAuthError("state_mismatch", "unreadable state");
  }
  if (payload.provider !== provider || payload.exp < Date.now() || !safeEqual(payload.state, state)) {
    securityEvent("oauth.state_mismatch", { provider });
    throw new OAuthError("state_mismatch", "state mismatch");
  }
  return payload;
}

async function exchangeCode(p: OAuthProviderId, code: string, verifier: string): Promise<string> {
  const creds = oauthCredentials(p)!;
  const f = fetchOverride ?? fetch;
  const res = await f(defs()[p].tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(p), client_id: creds.clientId, client_secret: creds.clientSecret, code_verifier: verifier }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok || !body.access_token) throw new OAuthError("provider_error", `token exchange failed (${res.status})`);
  return body.access_token;
}

export type OAuthResult =
  | { kind: "session"; token: string; expiresAt: Date; mfaRequired: boolean; created: boolean; locale: string; next: string | null }
  | { kind: "linked"; locale: string };

/** Complete the flow: exchange the code, then sign in / create / link according to the policy above. */
export async function completeOAuth(ctx: RequestContext, state: StatePayload, code: string, currentUserId: string | null): Promise<OAuthResult> {
  const p = state.provider;
  if (!oauthCredentials(p)) throw new OAuthError("not_configured", "OAuth provider not configured.");
  const accessToken = await exchangeCode(p, code, state.verifier);
  const identity = await defs()[p].identity(accessToken, fetchOverride ?? fetch);
  if (!identity.subject || identity.subject === "undefined") throw new OAuthError("provider_error", "no subject");
  const email = identity.email?.trim().toLowerCase() ?? null;

  if (state.mode === "link") {
    if (!state.userId || state.userId !== currentUserId) throw new OAuthError("state_mismatch", "link session changed");
    return transaction(async (tx) => {
      const existing = await tx.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider: p, providerAccountId: identity.subject } } });
      if (existing && existing.userId !== state.userId) throw new OAuthError("already_linked", "identity linked elsewhere");
      if (!existing) {
        const sameProvider = await tx.oAuthAccount.findUnique({ where: { userId_provider: { userId: state.userId!, provider: p } } });
        if (sameProvider) throw new OAuthError("already_linked", "provider already linked");
        await tx.oAuthAccount.create({ data: { userId: state.userId!, provider: p, providerAccountId: identity.subject, providerEmail: email } });
        await writeAudit(tx, { ...ctx, actor: { type: "USER", id: state.userId } }, { category: "SECURITY", action: "auth.oauth_linked", resourceType: "user", resourceId: state.userId, newValue: { provider: p } });
      }
      return { kind: "linked" as const, locale: state.locale };
    });
  }

  return transaction(async (tx) => {
    const linked = await tx.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider: p, providerAccountId: identity.subject } }, include: { user: true } });
    let userId: string;
    let created = false;
    let mfaRequired = false;
    if (linked) {
      if (linked.user.status !== "ACTIVE") throw new OAuthError("account_disabled", "account disabled");
      userId = linked.userId;
      mfaRequired = linked.user.mfaEnabled;
      await tx.oAuthAccount.update({ where: { id: linked.id }, data: { lastLoginAt: new Date(), providerEmail: email } });
    } else {
      if (email && (await tx.user.findUnique({ where: { email } }))) {
        securityEvent("oauth.account_exists_refused", { provider: p });
        throw new OAuthError("account_exists", "email belongs to an existing account");
      }
      if (!email || !identity.emailVerified) throw new OAuthError("email_unverified", "provider email not verified");
      const user = await tx.user.create({
        data: { email, name: identity.name?.slice(0, 120) || email.split("@")[0]!, passwordHash: null, emailVerifiedAt: new Date(), locale: state.locale },
      });
      await tx.oAuthAccount.create({ data: { userId: user.id, provider: p, providerAccountId: identity.subject, providerEmail: email, lastLoginAt: new Date() } });
      const actor: RequestContext = { ...ctx, actor: { type: "USER", id: user.id } };
      await writeAudit(tx, actor, { category: "SECURITY", action: "user.registered", resourceType: "user", resourceId: user.id, newValue: { via: p } });
      await emitEvent(tx, actor, "user.registered", { userId: user.id, locale: user.locale }, { aggregateType: "user", aggregateId: user.id });
      userId = user.id;
      created = true;
    }
    const { token, session } = await createSession(tx, userId, { mfaPending: mfaRequired, ip: ctx.ip, userAgent: ctx.userAgent });
    await writeAudit(tx, { ...ctx, actor: { type: "USER", id: userId } }, { category: "SECURITY", action: mfaRequired ? "auth.sign_in_mfa_pending" : "auth.sign_in", resourceType: "session", resourceId: session.id, newValue: { via: p } });
    return { kind: "session" as const, token, expiresAt: session.expiresAt, mfaRequired, created, locale: state.locale, next: state.next };
  });
}

/** Providers linked to a user (for Settings → Security). */
export async function linkedProviders(userId: string) {
  return db().oAuthAccount.findMany({ where: { userId }, select: { provider: true, providerEmail: true, createdAt: true } });
}
