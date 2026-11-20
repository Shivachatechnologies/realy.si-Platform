import "server-only";
import { env } from "@/server/core/env";
import { providerInfo, type ConnectionAccount, type ProviderInfo } from "./catalog";
import { objectUrl, s3TargetOf, signS3Request } from "./sigv4";

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
  /** Name of the client id parameter (TikTok: client_key, TikTok for Business: app_id). */
  clientIdParam?: string;
  revoke?: (token: string, client: OAuthClient) => Promise<void>;
  /** Non-standard code exchange (TikTok for Business). */
  exchange?: (code: string, client: OAuthClient) => Promise<TokenSet>;
  /** Runs after the code exchange, e.g. to swap a short-lived token for a long-lived one (Meta, Threads) or read metadata. */
  upgrade?: (tokens: TokenSet, client: OAuthClient) => Promise<TokenSet>;
  /** Non-standard refresh (Threads refreshes the long-lived token itself). */
  refresh?: (refreshToken: string, client: OAuthClient) => Promise<TokenSet>;
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
  /** Secret settings besides the key (e.g. Google Ads developer token); merged into Connection.config by getConnection. */
  secrets?: Record<string, string>;
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
    youtube: [e.OAUTH_GOOGLE_CLIENT_ID, e.OAUTH_GOOGLE_CLIENT_SECRET],
    google_search_console: [e.OAUTH_GOOGLE_CLIENT_ID, e.OAUTH_GOOGLE_CLIENT_SECRET],
    google_ads: [e.OAUTH_GOOGLE_CLIENT_ID, e.OAUTH_GOOGLE_CLIENT_SECRET],
    meta_ads: [e.FACEBOOK_APP_ID, e.FACEBOOK_APP_SECRET],
    linkedin_ads: [e.LINKEDIN_CLIENT_ID, e.LINKEDIN_CLIENT_SECRET],
    tiktok: [e.TIKTOK_CLIENT_KEY, e.TIKTOK_CLIENT_SECRET],
    threads: [e.THREADS_APP_ID, e.THREADS_APP_SECRET],
    pinterest: [e.PINTEREST_CLIENT_ID, e.PINTEREST_CLIENT_SECRET],
    tiktok_ads: [e.TIKTOK_ADS_APP_ID, e.TIKTOK_ADS_APP_SECRET],
    mailchimp: [e.MAILCHIMP_CLIENT_ID, e.MAILCHIMP_CLIENT_SECRET],
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
  // Meta: swap the short-lived user token (1-2 h) for a long-lived one (~60 days, not refreshable: reconnect to renew).
  const metaUpgrade = async (tokens: TokenSet, c: OAuthClient): Promise<TokenSet> => {
    const url = `${graph}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: c.clientId, client_secret: c.clientSecret, fb_exchange_token: tokens.accessToken })}`;
    const body = await getJson(url, {}).catch(() => null);
    if (!body || typeof body.access_token !== "string") return tokens;
    const expiresIn = Number(body.expires_in ?? 0);
    return { ...tokens, accessToken: body.access_token, refreshToken: null, expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : tokens.expiresAt };
  };
  defs.facebook!.upgrade = metaUpgrade;
  defs.instagram = { ...defs.facebook! };
  defs.meta_ads = { ...defs.facebook! };
  defs.youtube = { ...defs.google! };
  defs.google_search_console = { ...defs.google! };
  defs.google_ads = { ...defs.google! };
  defs.linkedin_ads = { ...defs.linkedin! };
  defs.tiktok = {
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopeSeparator: ",",
    pkce: false,
    tokenAuth: "body",
    clientIdParam: "client_key",
    revoke: (token, c) => revokeForm("https://open.tiktokapis.com/v2/oauth/revoke/", { client_key: c.clientId, client_secret: c.clientSecret, token }),
  };
  const threadsLong = async (url: string, previous: TokenSet | null): Promise<TokenSet> => {
    const body = await getJson(url, {});
    if (typeof body.access_token !== "string") throw new ProviderError("Threads returned no long-lived token");
    const expiresIn = Number(body.expires_in ?? 0);
    // The long-lived token is refreshed with itself, so it doubles as the refresh token.
    return { accessToken: body.access_token, refreshToken: body.access_token, expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null, scopes: previous?.scopes ?? null, extra: previous?.extra ?? {} };
  };
  defs.threads = {
    authorizeUrl: "https://threads.net/oauth/authorize",
    tokenUrl: "https://graph.threads.net/oauth/access_token",
    scopeSeparator: ",",
    pkce: false,
    tokenAuth: "body",
    upgrade: (tokens, c) =>
      threadsLong(`https://graph.threads.net/access_token?${new URLSearchParams({ grant_type: "th_exchange_token", client_secret: c.clientSecret, access_token: tokens.accessToken })}`, tokens),
    refresh: (token) => threadsLong(`https://graph.threads.net/refresh_access_token?${new URLSearchParams({ grant_type: "th_refresh_token", access_token: token })}`, null),
  };
  defs.pinterest = {
    authorizeUrl: "https://www.pinterest.com/oauth/",
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    scopeSeparator: ",",
    pkce: false,
    tokenAuth: "basic",
  };
  defs.mailchimp = {
    authorizeUrl: "https://login.mailchimp.com/oauth2/authorize",
    tokenUrl: "https://login.mailchimp.com/oauth2/token",
    scopeSeparator: " ",
    pkce: false,
    tokenAuth: "body",
    // Mailchimp tokens never expire; the data center (API host) comes from the metadata endpoint.
    upgrade: async (tokens) => {
      const meta = await getJson("https://login.mailchimp.com/oauth2/metadata", { authorization: `OAuth ${tokens.accessToken}` });
      return { ...tokens, extra: { ...tokens.extra, authMode: "oauth", serverPrefix: str(meta.dc), accountName: str(meta.accountname) } };
    },
  };
  defs.tiktok_ads = {
    authorizeUrl: "https://business-api.tiktok.com/portal/auth",
    tokenUrl: "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
    scopeSeparator: ",",
    pkce: false,
    tokenAuth: "body",
    clientIdParam: "app_id",
    // Marketing API tokens do not expire; the callback carries `auth_code`.
    exchange: async (code, c) => {
      const res = await fetch("https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ app_id: c.clientId, secret: c.clientSecret, auth_code: code }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string; data?: { access_token?: string; advertiser_ids?: string[]; scope?: number[] } };
      if (!res.ok || body.code !== 0 || !body.data?.access_token) throw new ProviderError(`token exchange failed (${body.message ?? res.status})`, res.status);
      return { accessToken: body.data.access_token, refreshToken: null, expiresAt: null, scopes: null, extra: { advertiserIds: body.data.advertiser_ids ?? [] } };
    },
  };
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
  if (provider === "tiktok" && typeof body.open_id === "string") extra.openId = body.open_id;
  if (provider === "threads" && body.user_id) extra.userId = String(body.user_id);
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
  const idParam = def.clientIdParam ?? "client_id";
  return def.tokenAuth === "basic" ? { form: { [idParam]: c.clientId }, headers: { authorization: basic(c) } } : { form: { [idParam]: c.clientId, client_secret: c.clientSecret }, headers: {} };
}

export async function exchangeCode(provider: string, code: string, verifier: string | null): Promise<TokenSet> {
  const def = oauthDef(provider);
  const client = oauthClient(provider);
  if (!def || !client) throw new ProviderError("provider not configured");
  let tokens: TokenSet;
  if (def.exchange) tokens = await def.exchange(code, client);
  else {
    const auth = clientAuth(def, client);
    const r = await postForm(
      def.tokenUrl,
      { grant_type: "authorization_code", code, redirect_uri: integrationRedirectUri(provider), ...auth.form, ...(def.pkce && verifier ? { code_verifier: verifier } : {}) },
      auth.headers,
    );
    if (!r.ok || r.body.ok === false) throw new ProviderError(`token exchange failed (${r.status})`, r.status);
    tokens = toTokenSet(provider, r.body);
  }
  return def.upgrade ? def.upgrade(tokens, client) : tokens;
}

export async function refreshAccessToken(provider: string, refreshToken: string): Promise<TokenSet> {
  const def = oauthDef(provider);
  const client = oauthClient(provider);
  if (!def || !client) throw new ProviderError("provider not configured");
  if (def.refresh) return def.refresh(refreshToken, client);
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

async function postJsonChecked(url: string, headers: Record<string, string>, json: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "user-agent": "Realy", ...headers }, body: JSON.stringify(json), signal: AbortSignal.timeout(TIMEOUT) });
  const text = await res.text();
  if (!res.ok) throw new ProviderError(`${new URL(url).host} responded ${res.status}`, res.status);
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const b64 = (v: string) => Buffer.from(v).toString("base64");
export const LINKEDIN_API_VERSION = "202605";
export const RUNWAY_API_VERSION = "2024-11-06";
export const SHOPIFY_API_VERSION = "2025-07";

/** Developer token for Google Ads: the company's own (stored encrypted) or the platform's. */
export const googleAdsDeveloperToken = (config: Record<string, unknown>) => str(config.developerToken) ?? env().GOOGLE_ADS_DEVELOPER_TOKEN ?? null;

/**
 * Authentication headers for a provider token/key (custom APIs use their configured header). Providers that
 * authenticate in the URL (SerpApi) or with signatures (S3) return no header; their callers add it.
 */
export function authHeaders(provider: string, token: string, config: Record<string, unknown>): Record<string, string> {
  const bearer = { authorization: `Bearer ${token}` };
  switch (provider) {
    case "custom_api": {
      const name = str(config.headerName) ?? "Authorization";
      const prefix = str(config.headerPrefix);
      return { [name]: prefix ? `${prefix} ${token}` : token };
    }
    case "openai":
      return { ...bearer, ...(str(config.organization) ? { "openai-organization": str(config.organization)! } : {}) };
    case "gemini":
      return { "x-goog-api-key": token };
    case "exa":
    case "apollo":
    case "pdl":
      return { "x-api-key": token };
    case "serpapi":
    case "hunter":
    case "s3":
      return {};
    case "runway":
      return { ...bearer, "x-runway-version": RUNWAY_API_VERSION };
    case "wordpress":
      return { authorization: `Basic ${b64(`${str(config.username) ?? ""}:${token.replace(/\s+/g, "")}`)}` };
    case "shopify":
      return { "x-shopify-access-token": token };
    case "twilio":
      return { authorization: `Basic ${b64(`${str(config.accountSid) ?? ""}:${token}`)}` };
    case "razorpay":
      return { authorization: `Basic ${b64(`${str(config.keyId) ?? ""}:${token}`)}` };
    case "mailchimp":
      return config.authMode === "oauth" ? bearer : { authorization: `Basic ${b64(`realy:${token}`)}` };
    case "tiktok_ads":
      return { "access-token": token };
    case "google_ads": {
      const dev = googleAdsDeveloperToken(config);
      const login = str(config.loginCustomerId);
      return { ...bearer, ...(dev ? { "developer-token": dev } : {}), ...(login ? { "login-customer-id": login } : {}) };
    }
    case "linkedin_ads":
      return { ...bearer, "linkedin-version": LINKEDIN_API_VERSION, "x-restli-protocol-version": "2.0.0" };
    default:
      return bearer;
  }
}

/** Mailchimp data center: the configured server prefix or the API key suffix ("…-us21"). */
export function mailchimpServer(token: string, config: Record<string, unknown>): string | null {
  const dc = str(config.serverPrefix) ?? (config.authMode === "oauth" ? null : (token.split("-").pop() ?? null));
  return dc && /^[a-z]{2,4}\d{1,3}$/.test(dc) ? dc : null;
}

/** Shop domain of a Shopify connection, validated (it is interpolated into URLs). */
export function shopifyHost(config: Record<string, unknown>): string | null {
  const d = str(config.shopDomain);
  return d && /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(d) ? d : null;
}

const accountsOf = (items: unknown, type: string, idKey = "id", nameKey = "name"): ConnectionAccount[] =>
  (Array.isArray(items) ? items : [])
    .map((i) => i as Record<string, unknown>)
    .filter((i) => i[idKey] !== undefined && i[idKey] !== null)
    .slice(0, 100)
    .map((i) => ({ id: String(i[idKey]), name: String(i[nameKey] ?? i[idKey]).slice(0, 200), type }));

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
    case "facebook": {
      const u = await getJson("https://graph.facebook.com/v21.0/me?fields=id,name", bearer);
      const pages = await getJson("https://graph.facebook.com/v21.0/me/accounts?fields=id,name&limit=100", bearer).catch(() => ({}) as Record<string, unknown>);
      return { account: str(u.name) ?? str(u.id), extra: { accounts: accountsOf(pages.data, "page") } };
    }
    case "instagram": {
      const u = await getJson("https://graph.facebook.com/v21.0/me?fields=id,name", bearer);
      const pages = await getJson("https://graph.facebook.com/v21.0/me/accounts?fields=id,name,instagram_business_account{id,username}&limit=100", bearer).catch(() => ({}) as Record<string, unknown>);
      const accounts = (Array.isArray(pages.data) ? pages.data : [])
        .map((p) => (p as { name?: string; instagram_business_account?: { id?: string; username?: string } }))
        .filter((p) => p.instagram_business_account?.id)
        .map((p) => ({ id: p.instagram_business_account!.id!, name: p.instagram_business_account!.username ? `@${p.instagram_business_account!.username}` : (p.name ?? p.instagram_business_account!.id!), type: "instagram" }));
      return { account: str(u.name) ?? str(u.id), extra: { accounts } };
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
    case "openai": {
      const u = await getJson("https://api.openai.com/v1/models", authHeaders(provider, token, config));
      return { account: `OpenAI · ${Array.isArray(u.data) ? u.data.length : 0} models` };
    }
    case "gemini": {
      const u = await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=50", authHeaders(provider, token, config));
      return { account: `Gemini · ${Array.isArray(u.models) ? u.models.length : 0} models` };
    }
    case "tavily": {
      await postJsonChecked("https://api.tavily.com/search", bearer, { query: "connection test", max_results: 1, search_depth: "basic" });
      return { account: "Tavily" };
    }
    case "exa": {
      await postJsonChecked("https://api.exa.ai/search", authHeaders(provider, token, config), { query: "connection test", numResults: 1 });
      return { account: "Exa" };
    }
    case "serpapi": {
      // account.json does not consume search credits.
      const u = await getJson(`https://serpapi.com/account.json?${new URLSearchParams({ api_key: token })}`, {});
      return { account: str(u.account_email) ?? "SerpApi", extra: { plan: str(u.plan_name), searchesLeft: typeof u.total_searches_left === "number" ? u.total_searches_left : null } };
    }
    case "apollo": {
      // auth/health is free and says whether the key is valid.
      const u = await getJson("https://api.apollo.io/v1/auth/health", authHeaders(provider, token, config));
      if (u.is_logged_in === false) throw new ProviderError("Apollo did not accept this API key", 401);
      return { account: "Apollo.io" };
    }
    case "hunter": {
      // /account does not use search or verification credits.
      const u = await getJson(`https://api.hunter.io/v2/account?${new URLSearchParams({ api_key: token })}`, {});
      const d = (u.data ?? {}) as Record<string, unknown>;
      const req = (d.requests ?? {}) as Record<string, { used?: number; available?: number } | undefined>;
      return { account: str(d.email) ?? "Hunter.io", extra: { plan: str(d.plan_name), searchesLeft: typeof req.searches?.available === "number" && typeof req.searches?.used === "number" ? req.searches.available - req.searches.used : null } };
    }
    case "pdl": {
      // Autocomplete does not use person or company credits.
      await getJson(`https://api.peopledatalabs.com/v5/autocomplete?${new URLSearchParams({ field: "title", text: "founder", size: "1" })}`, authHeaders(provider, token, config));
      return { account: "People Data Labs" };
    }
    case "stability": {
      const u = await getJson("https://api.stability.ai/v1/user/account", bearer);
      return { account: str(u.email) ?? str(u.id) ?? "Stability AI" };
    }
    case "replicate": {
      const u = await getJson("https://api.replicate.com/v1/account", bearer);
      return { account: str(u.username) ?? str(u.name) ?? "Replicate" };
    }
    case "runway": {
      const u = await getJson("https://api.dev.runwayml.com/v1/organization", authHeaders(provider, token, config));
      return { account: typeof u.creditBalance === "number" ? `Runway · ${u.creditBalance} credits` : "Runway" };
    }
    case "youtube": {
      const u = await getJson("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50", bearer);
      const accounts = (Array.isArray(u.items) ? u.items : []).map((c) => c as { id: string; snippet?: { title?: string } }).map((c) => ({ id: c.id, name: c.snippet?.title ?? c.id, type: "channel" }));
      if (!accounts.length) throw new ProviderError("this Google account has no YouTube channel");
      return { account: accounts[0]!.name, extra: { accounts } };
    }
    case "google_search_console": {
      const u = await getJson("https://www.googleapis.com/webmasters/v3/sites", bearer);
      const accounts = (Array.isArray(u.siteEntry) ? u.siteEntry : [])
        .map((x) => x as { siteUrl: string; permissionLevel?: string })
        .filter((x) => x.permissionLevel !== "siteUnverifiedUser")
        .map((x) => ({ id: x.siteUrl, name: x.siteUrl, type: "site" }));
      return { account: `${accounts.length} sites`, extra: { accounts } };
    }
    case "google_ads": {
      if (!googleAdsDeveloperToken(config)) throw new ProviderError("Google Ads developer token missing: set GOOGLE_ADS_DEVELOPER_TOKEN or the connection's developer token");
      const u = await getJson(`https://googleads.googleapis.com/${env().GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`, authHeaders(provider, token, config));
      const accounts = (Array.isArray(u.resourceNames) ? u.resourceNames : []).map(String).map((r) => r.replace("customers/", "")).map((id) => ({ id, name: id.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"), type: "ad_account" }));
      return { account: `${accounts.length} customer accounts`, extra: { accounts } };
    }
    case "meta_ads": {
      const u = await getJson("https://graph.facebook.com/v21.0/me/adaccounts?fields=account_id,name,account_status&limit=100", bearer);
      const accounts = accountsOf(u.data, "ad_account", "account_id");
      return { account: `${accounts.length} ad accounts`, extra: { accounts } };
    }
    case "linkedin_ads": {
      const u = await getJson("https://api.linkedin.com/rest/adAccounts?q=search&count=100", authHeaders(provider, token, config));
      const accounts = accountsOf(u.elements, "ad_account");
      return { account: `${accounts.length} ad accounts`, extra: { accounts } };
    }
    case "tiktok_ads": {
      const c = oauthClient("tiktok_ads");
      if (!c) throw new ProviderError("TikTok for Business app not configured");
      const res = await fetch(`https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/?${new URLSearchParams({ app_id: c.clientId, secret: c.clientSecret })}`, {
        headers: { accept: "application/json", "access-token": token },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string; data?: { list?: { advertiser_id: string; advertiser_name?: string }[] } };
      if (!res.ok || body.code !== 0) throw new ProviderError(`TikTok advertiser lookup failed: ${body.message ?? res.status}`, res.ok ? 401 : res.status);
      const accounts = accountsOf(body.data?.list, "ad_account", "advertiser_id", "advertiser_name");
      return { account: `${accounts.length} advertisers`, extra: { accounts } };
    }
    case "tiktok": {
      const u = await getJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", bearer);
      const user = (u.data as { user?: { display_name?: string; open_id?: string } } | undefined)?.user;
      return { account: str(user?.display_name) ?? str(user?.open_id), extra: user?.open_id ? { openId: user.open_id } : undefined };
    }
    case "threads": {
      const u = await getJson("https://graph.threads.net/v1.0/me?fields=id,username", bearer);
      return { account: str(u.username) ? `@${u.username}` : str(u.id), extra: str(u.id) ? { userId: u.id } : undefined };
    }
    case "pinterest": {
      const u = await getJson("https://api.pinterest.com/v5/user_account", bearer);
      const boards = await getJson("https://api.pinterest.com/v5/boards?page_size=100", bearer).catch(() => ({}) as Record<string, unknown>);
      return { account: str(u.username), extra: { accounts: accountsOf(boards.items, "board") } };
    }
    case "wordpress": {
      const site = str(config.siteUrl);
      if (!site) throw new ProviderError("site URL missing");
      const u = await getJson(`${site.replace(/\/+$/, "")}/wp-json/wp/v2/users/me?context=edit`, authHeaders(provider, token, config));
      return { account: `${str(u.name) ?? str(u.slug) ?? "user"} · ${new URL(site).host}` };
    }
    case "webflow": {
      const u = await getJson("https://api.webflow.com/v2/sites", bearer);
      const accounts = accountsOf(u.sites, "site", "id", "displayName");
      return { account: accounts[0]?.name ?? "Webflow", extra: { accounts } };
    }
    case "shopify": {
      const host = shopifyHost(config);
      if (!host) throw new ProviderError("shop domain missing");
      const u = await getJson(`https://${host}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, authHeaders(provider, token, config));
      const shop = u.shop as { name?: string; currency?: string } | undefined;
      return { account: str(shop?.name) ?? host, extra: shop?.currency ? { currency: shop.currency } : undefined };
    }
    case "sendgrid": {
      const u = await getJson("https://api.sendgrid.com/v3/scopes", bearer);
      const scopes = Array.isArray(u.scopes) ? u.scopes.map(String) : [];
      if (!scopes.includes("mail.send")) throw new ProviderError("the API key lacks the mail.send permission", 403);
      return { account: str(config.fromEmail) ?? "SendGrid", extra: { canSend: true } };
    }
    case "mailchimp": {
      const dc = mailchimpServer(token, config);
      if (!dc) throw new ProviderError("Mailchimp server prefix missing (e.g. us21)");
      const h = authHeaders(provider, token, config);
      await getJson(`https://${dc}.api.mailchimp.com/3.0/ping`, h);
      const lists = await getJson(`https://${dc}.api.mailchimp.com/3.0/lists?count=100&fields=lists.id,lists.name`, h).catch(() => ({}) as Record<string, unknown>);
      return { account: str(config.accountName) ?? `Mailchimp · ${dc}`, extra: { serverPrefix: dc, accounts: accountsOf(lists.lists, "audience") } };
    }
    case "twilio": {
      const sid = str(config.accountSid);
      if (!sid || !/^AC[a-f0-9]{32}$/.test(sid)) throw new ProviderError("account SID missing");
      const u = await getJson(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, authHeaders(provider, token, config));
      if (str(u.status) && u.status !== "active") throw new ProviderError(`Twilio account is ${String(u.status)}`, 403);
      return { account: str(u.friendly_name) ?? sid };
    }
    case "vapi":
    case "retell":
      return (await import("@/server/modules/voice/providers")).testVoiceConnection(provider, token);
    case "razorpay": {
      await getJson("https://api.razorpay.com/v1/payments?count=1", authHeaders(provider, token, config));
      const keyId = str(config.keyId) ?? "";
      return { account: `Razorpay · ${keyId.startsWith("rzp_test_") ? "test" : "live"} mode` };
    }
    case "s3": {
      const target = s3TargetOf(config, token);
      if (!target) throw new ProviderError("bucket, region or access key missing");
      const url = objectUrl(target);
      const res = await fetch(url, { method: "HEAD", headers: signS3Request(target, { method: "HEAD", url }), signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) throw new ProviderError(`HeadBucket failed (${res.status}${res.status === 301 ? ": wrong region" : res.status === 403 ? ": access denied" : res.status === 404 ? ": no such bucket" : ""})`, res.status);
      return { account: `${target.bucket} · ${target.endpoint ? new URL(target.endpoint).host : target.region}` };
    }
    case "cloudflare": {
      const v = await getJson("https://api.cloudflare.com/client/v4/user/tokens/verify", bearer);
      const status = (v.result as { status?: string } | undefined)?.status;
      if (status !== "active") throw new ProviderError(`Cloudflare token is ${status ?? "invalid"}`, 401);
      const acc = await getJson("https://api.cloudflare.com/client/v4/accounts?per_page=50", bearer).catch(() => ({}) as Record<string, unknown>);
      const accounts = accountsOf(acc.result, "account");
      return { account: accounts.find((a) => a.id === str(config.accountId))?.name ?? accounts[0]?.name ?? "Cloudflare", extra: { accounts } };
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
