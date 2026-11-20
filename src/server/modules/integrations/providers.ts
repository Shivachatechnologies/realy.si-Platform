import "server-only";
import { env } from "@/server/core/env";
import { providerInfo, type ProviderInfo } from "./catalog";

/**
 * Server-side provider definitions: OAuth endpoints and token handling, revocation and a lightweight "test connection"
 * call per provider. Secrets are passed in and never logged.
 */

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface OAuthDef {
  authorizeUrl: string;
  tokenUrl: string;
  /** Join character for the scope parameter. */
  scopeSeparator: string;
  pkce: boolean;
  /** Token endpoint client authentication: HTTP Basic or client_id/secret in the form body. */
  tokenAuth: "basic" | "body";
  extraAuthorizeParams?: Record<string, string>;
  revoke?: (token: string, client: OAuthClient) => Promise<void>;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[] | null;
  /** Provider-specific non-secret details captured at token time (instance URL, team...). */
  extra: Record<string, unknown>;
}

export interface ConnectionCredentials {
  accessToken?: string | null;
  refreshToken?: string | null;
  apiKey?: string | null;
}

export interface TestTarget {
  provider: string;
  token: string;
  config: Record<string, unknown>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

const TIMEOUT = 15_000;

/** OAuth client credentials from the environment, or null when the admin has not configured the provider. */
export function oauthClient(provider: string): OAuthClient | null {
  const e = env();
  const pairs: Record<string, [string | undefined, string | undefined]> = {
    google: [e.OAUTH_GOOGLE_CLIENT_ID, e.OAUTH_GOOGLE_CLIENT_SECRET],
    microsoft: [e.OAUTH_MICROSOFT_CLIENT_ID, e.OAUTH_MICROSOFT_CLIENT_SECRET],
    slack: [e.SLACK_CLIENT_ID, e.SLACK_CLIENT_SECRET],
    hubspot: [e.HUBSPOT_CLIENT_ID, e.HUBSPOT_CLIENT_SECRET],
    salesforce: [e.SALESFORCE_CLIENT_ID, e.SALESFORCE_CLIENT_SECRET],
    linkedin: [e.LINKEDIN_CLIENT_ID, e.LINKEDIN_CLIENT_SECRET],
    x: [e.X_CLIENT_ID, e.X_CLIENT_SECRET],
    facebook: [e.FACEBOOK_APP_ID, e.FACEBOOK_APP_SECRET],
    instagram: [e.FACEBOOK_APP_ID, e.FACEBOOK_APP_SECRET],
    quickbooks: [e.QUICKBOOKS_CLIENT_ID, e.QUICKBOOKS_CLIENT_SECRET],
    xero: [e.XERO_CLIENT_ID, e.XERO_CLIENT_SECRET],
  };
  const pair = pairs[provider];
  return pair?.[0] && pair[1] ? { clientId: pair[0], clientSecret: pair[1] } : null;
}

/** Env vars of the provider that are not set (shown on the setup page). */
export function missingEnvVars(info: ProviderInfo): string[] {
  const e = env() as unknown as Record<string, unknown>;
  return info.envVars.filter((v) => !e[v]);
}

async function postForm(url: string, form: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", ...headers },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = Object.fromEntries(new URLSearchParams(text));
  }
  return { ok: res.ok, status: res.status, body };
}

const basic = (c: OAuthClient) => `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;

async function revokeForm(url: string, form: Record<string, string>, headers: Record<string, string> = {}) {
  const r = await postForm(url, form, headers);
  if (!r.ok) throw new ProviderError(`revoke failed (${r.status})`, r.status);
}

export function oauthDef(provider: string): OAuthDef | null {
  const e = env();
  const graph = "https://graph.facebook.com/v21.0";
  const defs: Record<string, OAuthDef> = {
    google: {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopeSeparator: " ",
      pkce: true,
      tokenAuth: "body",
      extraAuthorizeParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
      revoke: (token) => revokeForm("https://oauth2.googleapis.com/revoke", { token }),
    },
    microsoft: {
      authorizeUrl: `https://login.microsoftonline.com/${e.OAUTH_MICROSOFT_TENANT}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${e.OAUTH_MICROSOFT_TENANT}/oauth2/v2.0/token`,
      scopeSeparator: " ",
      pkce: true,
      tokenAuth: "body",
    },
    slack: {
      authorizeUrl: "https://slack.com/oauth/v2/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.access",
      scopeSeparator: ",",
      pkce: false,
      tokenAuth: "body",
      revoke: async (token) => {
        const res = await fetch("https://slack.com/api/auth.revoke", { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT) });
        if (!res.ok) throw new ProviderError(`revoke failed (${res.status})`, res.status);
      },
    },
    hubspot: {
      authorizeUrl: "https://app.hubspot.com/oauth/authorize",
      tokenUrl: "https://api.hubapi.com/oauth/v1/token",
      scopeSeparator: " ",
      pkce: false,
      tokenAuth: "body",
    },
    salesforce: {
      authorizeUrl: `${e.SALESFORCE_LOGIN_URL}/services/oauth2/authorize`,
      tokenUrl: `${e.SALESFORCE_LOGIN_URL}/services/oauth2/token`,
      scopeSeparator: " ",
      pkce: true,
      tokenAuth: "body",
      revoke: (token) => revokeForm(`${e.SALESFORCE_LOGIN_URL}/services/oauth2/revoke`, { token }),
    },
    linkedin: {
      authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
      tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
      scopeSeparator: " ",
      pkce: false,
      tokenAuth: "body",
    },
    x: {
      authorizeUrl: "https://twitter.com/i/oauth2/authorize",
      tokenUrl: "https://api.twitter.com/2/oauth2/token",
      scopeSeparator: " ",
      pkce: true,
      tokenAuth: "basic",
      revoke: (token, c) => revokeForm("https://api.twitter.com/2/oauth2/revoke", { token, token_type_hint: "access_token" }, { authorization: basic(c) }),
    },
    facebook: {
      authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
      tokenUrl: `${graph}/oauth/access_token`,
      scopeSeparator: ",",
      pkce: false,
      tokenAuth: "body",
      revoke: async (token) => {
        const res = await fetch(`${graph}/me/permissions`, { method: "DELETE", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT) });
        if (!res.ok) throw new ProviderError(`revoke failed (${res.status})`, res.status);
      },
    },
    quickbooks: {
      authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
      tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      scopeSeparator: " ",
      pkce: false,
      tokenAuth: "basic",
      revoke: (token, c) => revokeForm("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", { token }, { authorization: basic(c) }),
    },
    xero: {
      authorizeUrl: "https://login.xero.com/identity/connect/authorize",
      tokenUrl: "https://identity.xero.com/connect/token",
      scopeSeparator: " ",
      pkce: true,
      tokenAuth: "basic",
      revoke: (token, c) => revokeForm("https://identity.xero.com/connect/revocation", { token }, { authorization: basic(c) }),
    },
  };
  defs.instagram = { ...defs.facebook! };
  return defs[provider] ?? null;
}

export const integrationRedirectUri = (provider: string) => `${env().APP_URL}/api/v1/integrations/oauth/${provider}/callback`;

function toTokenSet(provider: string, body: Record<string, unknown>, previousRefresh: string | null = null): TokenSet {
  // Slack v2 returns the bot token at the top level; Salesforce omits expires_in (session-based, refreshed on 401).
  const accessToken = typeof body.access_token === "string" ? body.access_token : null;
  if (!accessToken) throw new ProviderError("no access token in provider response");
  const expiresIn = Number(body.expires_in ?? body.expires ?? 0);
  const scope = typeof body.scope === "string" ? body.scope.split(/[ ,]+/).filter(Boolean) : null;
  const extra: Record<string, unknown> = {};
  if (provider === "salesforce" && typeof body.instance_url === "string") extra.instanceUrl = body.instance_url;
  if (provider === "slack") {
    const team = body.team as { id?: string; name?: string } | undefined;
    if (team?.name) extra.teamName = team.name;
    if (team?.id) extra.teamId = team.id;
  }
  if (provider === "hubspot" && body.hub_id) extra.hubId = String(body.hub_id);
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : previousRefresh,
    // Salesforce sessions last 2 h by default and the token response has no expiry: refresh after 90 minutes.
    expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : provider === "salesforce" ? new Date(Date.now() + 90 * 60_000) : null,
    scopes: scope,
    extra,
  };
}

function clientAuth(def: OAuthDef, c: OAuthClient): { form: Record<string, string>; headers: Record<string, string> } {
  return def.tokenAuth === "basic" ? { form: { client_id: c.clientId }, headers: { authorization: basic(c) } } : { form: { client_id: c.clientId, client_secret: c.clientSecret }, headers: {} };
}

export async function exchangeCode(provider: string, code: string, verifier: string | null): Promise<TokenSet> {
  const def = oauthDef(provider);
  const client = oauthClient(provider);
  if (!def || !client) throw new ProviderError("provider not configured");
  const auth = clientAuth(def, client);
  const r = await postForm(
    def.tokenUrl,
    { grant_type: "authorization_code", code, redirect_uri: integrationRedirectUri(provider), ...auth.form, ...(def.pkce && verifier ? { code_verifier: verifier } : {}) },
    auth.headers,
  );
  if (!r.ok || r.body.ok === false) throw new ProviderError(`token exchange failed (${r.status})`, r.status);
  return toTokenSet(provider, r.body);
}

export async function refreshAccessToken(provider: string, refreshToken: string): Promise<TokenSet> {
  const def = oauthDef(provider);
  const client = oauthClient(provider);
  if (!def || !client) throw new ProviderError("provider not configured");
  const auth = clientAuth(def, client);
  const r = await postForm(def.tokenUrl, { grant_type: "refresh_token", refresh_token: refreshToken, ...auth.form }, auth.headers);
  if (!r.ok || r.body.ok === false) throw new ProviderError(`token refresh failed (${r.status})`, r.status);
  return toTokenSet(provider, r.body, refreshToken);
}

export async function revokeToken(provider: string, token: string): Promise<boolean> {
  const def = oauthDef(provider);
  const client = oauthClient(provider);
  if (!def?.revoke || !client) return false;
  await def.revoke(token, client);
  return true;
}

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "Realy", ...headers }, signal: AbortSignal.timeout(TIMEOUT) });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  if (!res.ok) throw new ProviderError(`${new URL(url).host} responded ${res.status}`, res.status);
  return body;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Authorization header for a provider token (custom APIs use their configured header). */
export function authHeaders(provider: string, token: string, config: Record<string, unknown>): Record<string, string> {
  if (provider === "custom_api") {
    const name = str(config.headerName) ?? "Authorization";
    const prefix = str(config.headerPrefix);
    return { [name]: prefix ? `${prefix} ${token}` : token };
  }
  return { authorization: `Bearer ${token}` };
}

/**
 * Lightweight authenticated call proving the credentials work. Returns the connected account's display label.
 * Throws ProviderError with the HTTP status on failure.
 */
export async function testConnection({ provider, token, config }: TestTarget): Promise<{ account: string | null; extra?: Record<string, unknown> }> {
  const bearer = { authorization: `Bearer ${token}` };
  switch (provider) {
    case "google": {
      const u = await getJson("https://openidconnect.googleapis.com/v1/userinfo", bearer);
      return { account: str(u.email) ?? str(u.name) };
    }
    case "microsoft": {
      const u = await getJson("https://graph.microsoft.com/v1.0/me", bearer);
      return { account: str(u.mail) ?? str(u.userPrincipalName) ?? str(u.displayName) };
    }
    case "slack": {
      const res = await fetch("https://slack.com/api/auth.test", { method: "POST", headers: bearer, signal: AbortSignal.timeout(TIMEOUT) });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || body.ok !== true) throw new ProviderError(`Slack auth.test failed: ${str(body.error) ?? res.status}`, res.ok ? 401 : res.status);
      return { account: str(body.team) ?? str(body.url) };
    }
    case "stripe": {
      await getJson("https://api.stripe.com/v1/balance", bearer);
      const acct = await getJson("https://api.stripe.com/v1/account", bearer).catch(() => ({}) as Record<string, unknown>);
      const settings = acct.settings as { dashboard?: { display_name?: string } } | undefined;
      return { account: str(settings?.dashboard?.display_name) ?? str(acct.email) ?? str(acct.id) ?? "Stripe" };
    }
    case "whatsapp": {
      const id = str(config.phoneNumberId);
      if (!id) throw new ProviderError("phone number id missing");
      const u = await getJson(`https://graph.facebook.com/v21.0/${encodeURIComponent(id)}?fields=display_phone_number,verified_name`, bearer);
      return { account: [str(u.verified_name), str(u.display_phone_number)].filter(Boolean).join(" · ") || id };
    }
    case "hubspot": {
      const u = await getJson(`https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(token)}`, {});
      return { account: str(u.hub_domain) ?? str(u.user) };
    }
    case "salesforce": {
      const instance = str(config.instanceUrl);
      if (!instance) throw new ProviderError("instance URL missing");
      const u = await getJson(`${instance}/services/oauth2/userinfo`, bearer);
      return { account: str(u.preferred_username) ?? str(u.email) ?? str(u.name) };
    }
    case "linkedin": {
      const u = await getJson("https://api.linkedin.com/v2/userinfo", bearer);
      return { account: str(u.email) ?? str(u.name), extra: str(u.sub) ? { memberId: u.sub } : undefined };
    }
    case "x": {
      const u = await getJson("https://api.twitter.com/2/users/me", bearer);
      const data = u.data as { username?: string; id?: string } | undefined;
      return { account: data?.username ? `@${data.username}` : null, extra: data?.id ? { userId: data.id } : undefined };
    }
    case "facebook":
    case "instagram": {
      const u = await getJson("https://graph.facebook.com/v21.0/me?fields=id,name", bearer);
      return { account: str(u.name) ?? str(u.id) };
    }
    case "quickbooks": {
      const realm = str(config.realmId);
      if (!realm) throw new ProviderError("company (realm) id missing");
      const host = env().QUICKBOOKS_ENVIRONMENT === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
      const u = await getJson(`${host}/v3/company/${encodeURIComponent(realm)}/companyinfo/${encodeURIComponent(realm)}`, bearer);
      const info = u.CompanyInfo as { CompanyName?: string } | undefined;
      return { account: str(info?.CompanyName) ?? realm };
    }
    case "xero": {
      const res = await fetch("https://api.xero.com/connections", { headers: { ...bearer, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) throw new ProviderError(`api.xero.com responded ${res.status}`, res.status);
      const tenants = (await res.json()) as { tenantId: string; tenantName?: string }[];
      if (!tenants.length) throw new ProviderError("no Xero organisation is authorized");
      return { account: tenants[0]!.tenantName ?? tenants[0]!.tenantId, extra: { tenantId: tenants[0]!.tenantId } };
    }
    case "custom_api": {
      const base = str(config.baseUrl);
      if (!base) throw new ProviderError("base URL missing");
      const url = `${base.replace(/\/+$/, "")}${str(config.testPath) ?? ""}`;
      const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "Realy", ...authHeaders(provider, token, config) }, signal: AbortSignal.timeout(TIMEOUT), redirect: "manual" });
      if (res.status === 401 || res.status === 403 || res.status >= 500) throw new ProviderError(`${new URL(url).host} responded ${res.status}`, res.status);
      return { account: new URL(base).host };
    }
    default:
      throw new ProviderError("this provider has no connection test");
  }
}

/** Fetch provider-specific details right after an OAuth connection (e.g. QuickBooks realm is given in the callback). */
export async function postConnectDetails(provider: string, token: string): Promise<Record<string, unknown>> {
  if (provider === "xero") {
    const r = await testConnection({ provider, token, config: {} });
    return r.extra ?? {};
  }
  return {};
}

export function requireProvider(key: string): ProviderInfo {
  const info = providerInfo(key);
  if (!info) throw new ProviderError("unknown provider");
  return info;
}
