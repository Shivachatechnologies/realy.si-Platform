import "server-only";
import { guardedFetch, isPrivateAddress, OutboundBlockedError, type GuardedInit } from "@/server/core/outbound";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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
  /** Revoke the grant at the provider; `config` is the connection's stored (non-secret) config (e.g. Stripe's account id). */
  revoke?: (token: string, client: OAuthClient, config: Record<string, unknown>) => Promise<void>;
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
  /** Provider-specific secrets captured at token time (e.g. the WhatsApp two-step PIN); stored encrypted, never in config. */
  secrets?: Record<string, string>;
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
    google_drive: [e.OAUTH_GOOGLE_CLIENT_ID, e.OAUTH_GOOGLE_CLIENT_SECRET],
    meta_ads: [e.FACEBOOK_APP_ID, e.FACEBOOK_APP_SECRET],
    linkedin_ads: [e.LINKEDIN_CLIENT_ID, e.LINKEDIN_CLIENT_SECRET],
    tiktok: [e.TIKTOK_CLIENT_KEY, e.TIKTOK_CLIENT_SECRET],
    threads: [e.THREADS_APP_ID, e.THREADS_APP_SECRET],
    pinterest: [e.PINTEREST_CLIENT_ID, e.PINTEREST_CLIENT_SECRET],
    tiktok_ads: [e.TIKTOK_ADS_APP_ID, e.TIKTOK_ADS_APP_SECRET],
    mailchimp: [e.MAILCHIMP_CLIENT_ID, e.MAILCHIMP_CLIENT_SECRET],
    // B33: OAuth for providers that had only an API-key path (the customer connects their own account with Connect).
    calendly: [e.CALENDLY_CLIENT_ID, e.CALENDLY_CLIENT_SECRET],
    zendesk: [e.ZENDESK_CLIENT_ID, e.ZENDESK_CLIENT_SECRET],
    intercom: [e.INTERCOM_CLIENT_ID, e.INTERCOM_CLIENT_SECRET],
    shopify: [e.SHOPIFY_CLIENT_ID, e.SHOPIFY_CLIENT_SECRET],
    notion: [e.NOTION_CLIENT_ID, e.NOTION_CLIENT_SECRET],
    webflow: [e.WEBFLOW_CLIENT_ID, e.WEBFLOW_CLIENT_SECRET],
    clickup: [e.CLICKUP_CLIENT_ID, e.CLICKUP_CLIENT_SECRET],
    // The customer's own accounts through Realy's platform apps (docs/integrations.md §7). Stripe Connect authenticates
    // the token call with the platform's secret key (the same STRIPE_SECRET_KEY as Realy's billing, a separate use).
    stripe: [e.STRIPE_CONNECT_CLIENT_ID, e.STRIPE_SECRET_KEY],
    razorpay: [e.RAZORPAY_CLIENT_ID, e.RAZORPAY_CLIENT_SECRET],
    // Embedded Signup also needs the Facebook Login for Business configuration id.
    whatsapp: e.WHATSAPP_CONFIG_ID ? [e.WHATSAPP_APP_ID, e.WHATSAPP_APP_SECRET] : [undefined, undefined],
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

/**
 * Per-account OAuth endpoints (B33): the customer names their Zendesk subdomain / Shopify shop before the consent
 * screen. The value is validated here, carried in the signed state cookie and stored in the connection config.
 */
export const OAUTH_CONNECT_PARAMS: Record<string, { key: "subdomain" | "shopDomain"; pattern: RegExp }> = {
  zendesk: { key: "subdomain", pattern: /^[a-z0-9][a-z0-9-]{0,62}$/ },
  shopify: { key: "shopDomain", pattern: /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/ },
};

/** Validated connect parameters of a provider (throws ProviderError on a missing / malformed value). */
export function oauthConnectParams(provider: string, raw: Record<string, unknown> = {}): Record<string, string> {
  const spec = OAUTH_CONNECT_PARAMS[provider];
  if (!spec) return {};
  const v = typeof raw[spec.key] === "string" ? (raw[spec.key] as string).trim().toLowerCase() : "";
  // Shopify: accept the bare shop name too ("acme" → acme.myshopify.com).
  const value = provider === "shopify" && v && !v.includes(".") ? `${v}.myshopify.com` : v;
  if (!spec.pattern.test(value)) throw new ProviderError(`${spec.key} missing or invalid`, 400);
  return { [spec.key]: value };
}

export function oauthDef(provider: string, params: Record<string, unknown> = {}): OAuthDef | null {
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
  defs.google_drive = { ...defs.google! };
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
  // ── The customer's own accounts (Stripe Connect, Razorpay Partner OAuth, WhatsApp Embedded Signup) ──
  defs.stripe = {
    authorizeUrl: "https://connect.stripe.com/oauth/authorize",
    tokenUrl: "https://connect.stripe.com/oauth/token",
    scopeSeparator: " ",
    pkce: false,
    tokenAuth: "basic",
    // Stripe authenticates /oauth/token with the platform's secret key (HTTP Basic, key as the user name).
    exchange: (code, c) => stripeToken({ grant_type: "authorization_code", code }, c),
    refresh: (refreshToken, c) => stripeToken({ grant_type: "refresh_token", refresh_token: refreshToken }, c),
    // Disconnect detaches the connected account from Realy's platform (POST /oauth/deauthorize).
    revoke: async (_token, c, config) => {
      const account = str(config.stripeAccountId);
      if (!account || !/^acct_[A-Za-z0-9]{6,64}$/.test(account)) throw new ProviderError("Stripe account id missing");
      await revokeForm("https://connect.stripe.com/oauth/deauthorize", { client_id: c.clientId, stripe_user_id: account }, { authorization: stripeBasic(c) });
    },
  };
  defs.razorpay = {
    authorizeUrl: "https://auth.razorpay.com/authorize",
    tokenUrl: "https://auth.razorpay.com/token",
    scopeSeparator: " ",
    pkce: false,
    tokenAuth: "body",
    // Access tokens last 90 days and are refreshed with the refresh token (standard grant). "test" mode for sandboxes.
    exchange: async (code, c) => {
      const r = await postForm("https://auth.razorpay.com/token", { grant_type: "authorization_code", code, redirect_uri: integrationRedirectUri("razorpay"), client_id: c.clientId, client_secret: c.clientSecret, mode: e.RAZORPAY_OAUTH_MODE ?? "live" });
      if (!r.ok) throw new ProviderError(`token exchange failed (${r.status})`, r.status);
      return toTokenSet("razorpay", r.body);
    },
    revoke: (token, c) => revokeForm("https://auth.razorpay.com/revoke", { client_id: c.clientId, client_secret: c.clientSecret, token_type_hint: "access_token", token }),
  };
  defs.whatsapp = {
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: `${graph}/oauth/access_token`,
    scopeSeparator: ",",
    pkce: false,
    tokenAuth: "body",
    // Facebook Login for Business with the Embedded Signup configuration (WhatsApp product, business token).
    extraAuthorizeParams: {
      ...(e.WHATSAPP_CONFIG_ID ? { config_id: e.WHATSAPP_CONFIG_ID } : {}),
      override_default_response_type: "true",
      extras: JSON.stringify({ setup: {}, featureType: "", sessionInfoVersion: "3" }),
    },
    // After the code exchange: find the WhatsApp Business account and phone number the customer shared, subscribe
    // Realy's app to the account's webhooks and register the number for the Cloud API (docs/integrations.md §7).
    upgrade: (tokens, c) => whatsappEmbeddedSignup(tokens, c),
    revoke: async (token) => {
      const res = await fetch(`${graph}/me/permissions`, { method: "DELETE", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) throw new ProviderError(`revoke failed (${res.status})`, res.status);
    },
  };
  // ───── B33 ─────
  defs.calendly = {
    authorizeUrl: "https://auth.calendly.com/oauth/authorize",
    tokenUrl: "https://auth.calendly.com/oauth/token",
    scopeSeparator: " ",
    pkce: true,
    tokenAuth: "body",
    revoke: (token, c) => revokeForm("https://auth.calendly.com/oauth/revoke", { client_id: c.clientId, client_secret: c.clientSecret, token }),
  };
  defs.intercom = {
    authorizeUrl: "https://app.intercom.com/oauth",
    tokenUrl: "https://api.intercom.io/auth/eagle/token",
    scopeSeparator: " ",
    pkce: false,
    tokenAuth: "body",
  };
  defs.notion = {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopeSeparator: " ",
    pkce: false,
    tokenAuth: "basic",
    extraAuthorizeParams: { owner: "user" },
    // Notion's token endpoint takes JSON (HTTP Basic client authentication).
    exchange: async (code, c) => {
      const res = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: { authorization: basic(c), "content-type": "application/json", accept: "application/json", "notion-version": NOTION_API_VERSION },
        body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: integrationRedirectUri("notion") }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new ProviderError(`token exchange failed (${res.status})`, res.status);
      const t = toTokenSet("notion", body);
      if (typeof body.workspace_name === "string") t.extra.workspaceName = body.workspace_name;
      if (typeof body.workspace_id === "string") t.extra.workspaceId = body.workspace_id;
      return t;
    },
  };
  defs.webflow = {
    authorizeUrl: "https://webflow.com/oauth/authorize",
    tokenUrl: "https://api.webflow.com/oauth/access_token",
    scopeSeparator: " ",
    pkce: false,
    tokenAuth: "body",
  };
  defs.clickup = {
    authorizeUrl: "https://app.clickup.com/api",
    tokenUrl: "https://api.clickup.com/api/v2/oauth/token",
    scopeSeparator: " ",
    pkce: false,
    tokenAuth: "body",
    // ClickUp takes the code exchange as query parameters.
    exchange: async (code, c) => {
      const res = await fetch(`https://api.clickup.com/api/v2/oauth/token?${new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, code })}`, { method: "POST", headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new ProviderError(`token exchange failed (${res.status})`, res.status);
      return toTokenSet("clickup", body);
    },
  };
  const sub = typeof params.subdomain === "string" && OAUTH_CONNECT_PARAMS.zendesk!.pattern.test(params.subdomain) ? params.subdomain : null;
  if (sub) {
    defs.zendesk = {
      authorizeUrl: `https://${sub}.zendesk.com/oauth/authorizations/new`,
      tokenUrl: `https://${sub}.zendesk.com/oauth/tokens`,
      scopeSeparator: " ",
      pkce: true,
      tokenAuth: "body",
      revoke: async (token) => {
        const res = await fetch(`https://${sub}.zendesk.com/api/v2/oauth/tokens/current.json`, { method: "DELETE", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT) });
        if (!res.ok && res.status !== 401 && res.status !== 404) throw new ProviderError(`revoke failed (${res.status})`, res.status);
      },
    };
  }
  const shop = typeof params.shopDomain === "string" && OAUTH_CONNECT_PARAMS.shopify!.pattern.test(params.shopDomain) ? params.shopDomain : null;
  if (shop) {
    defs.shopify = {
      authorizeUrl: `https://${shop}/admin/oauth/authorize`,
      tokenUrl: `https://${shop}/admin/oauth/access_token`,
      scopeSeparator: ",",
      pkce: false,
      tokenAuth: "body",
      revoke: async (token) => {
        // Uninstalling the app is how a Shopify offline token is revoked.
        const res = await fetch(`https://${shop}/admin/api_permissions/current.json`, { method: "DELETE", headers: { "x-shopify-access-token": token }, signal: AbortSignal.timeout(TIMEOUT) });
        if (!res.ok && res.status !== 401 && res.status !== 404) throw new ProviderError(`revoke failed (${res.status})`, res.status);
      },
    };
  }
  return defs[provider] ?? null;
}

/**
 * Shopify signs the OAuth callback query (hmac = HMAC-SHA256 over the sorted other parameters, hex, with the app
 * secret). Verify it before the code exchange, and that the shop is the one the flow started for.
 */
export function verifyShopifyCallback(query: URLSearchParams, secret: string, expectedShop: string): boolean {
  const hmac = query.get("hmac");
  if (!hmac || query.get("shop") !== expectedShop) return false;
  const message = [...query.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const digest = createHmac("sha256", secret).update(message).digest("hex");
  return digest.length === hmac.length && timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

const stripeBasic = (c: OAuthClient) => `Basic ${Buffer.from(`${c.clientSecret}:`).toString("base64")}`;

/** Stripe Connect token call (authorization code or refresh); returns the connected account's token and its id. */
async function stripeToken(form: Record<string, string>, c: OAuthClient): Promise<TokenSet> {
  const r = await postForm("https://connect.stripe.com/oauth/token", form, { authorization: stripeBasic(c) });
  if (!r.ok) throw new ProviderError(`token exchange failed (${r.status}${typeof r.body.error === "string" ? `: ${r.body.error}` : ""})`, r.status);
  return toTokenSet("stripe", r.body, form.refresh_token ?? null);
}

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * WhatsApp Embedded Signup, server side: the business token's granular scopes name the WhatsApp Business account(s)
 * the customer shared (debug_token); its phone numbers are listed, Realy's app is subscribed to the account (so its
 * webhooks reach Realy's app-level callback, routed by phone_number_id) and the number is registered for the Cloud API
 * with a random two-step PIN (kept encrypted; registration is skipped when the number is already registered).
 */
export async function whatsappEmbeddedSignup(tokens: TokenSet, c: OAuthClient): Promise<TokenSet> {
  const token = tokens.accessToken;
  const app = `${c.clientId}|${c.clientSecret}`;
  const debug = await getJson(`${GRAPH}/debug_token?${new URLSearchParams({ input_token: token })}`, { authorization: `Bearer ${app}` });
  const data = (debug.data ?? {}) as { granular_scopes?: { scope?: string; target_ids?: string[] }[]; expires_at?: number };
  const wabaIds = [...new Set((data.granular_scopes ?? []).filter((g) => g.scope === "whatsapp_business_management" || g.scope === "whatsapp_business_messaging").flatMap((g) => g.target_ids ?? []))].filter((id) => /^\d{5,25}$/.test(id));
  if (!wabaIds.length) throw new ProviderError("No WhatsApp Business account was shared during sign-up", 403);
  const bearer = { authorization: `Bearer ${token}` };
  let waba: string | null = null;
  let phones: { id: string; name: string }[] = [];
  for (const id of wabaIds) {
    const list = await getJson(`${GRAPH}/${id}/phone_numbers?fields=id,display_phone_number,verified_name`, bearer).catch(() => ({}) as Record<string, unknown>);
    const items = (Array.isArray(list.data) ? list.data : []) as { id?: unknown; display_phone_number?: unknown; verified_name?: unknown }[];
    const found = items.filter((p) => typeof p.id === "string" && /^\d{5,25}$/.test(p.id)).map((p) => ({ id: String(p.id), name: [str(p.verified_name), str(p.display_phone_number)].filter(Boolean).join(" · ") || String(p.id) }));
    if (found.length) {
      waba = id;
      phones = found;
      break;
    }
  }
  if (!waba || !phones.length) throw new ProviderError("The WhatsApp Business account has no phone number yet", 409);
  // Webhooks of this account go to Realy's app (app-level callback URL); routing happens by phone_number_id.
  await postJsonChecked(`${GRAPH}/${waba}/subscribed_apps`, bearer, {}).catch(() => null);
  const pin = String(randomInt(100000, 1000000));
  const registered = await postJsonChecked(`${GRAPH}/${phones[0]!.id}/register`, bearer, { messaging_product: "whatsapp", pin }).then(
    () => true,
    () => false,
  );
  const expiresAt = typeof data.expires_at === "number" && data.expires_at > 0 ? new Date(data.expires_at * 1000) : tokens.expiresAt;
  return {
    ...tokens,
    expiresAt,
    extra: {
      ...tokens.extra,
      authMode: "embedded_signup",
      businessAccountId: waba,
      phoneNumberId: phones[0]!.id,
      accounts: phones.map((p) => ({ id: p.id, name: p.name, type: "phone" })),
      activeAccountId: phones[0]!.id,
    },
    ...(registered ? { secrets: { ...(tokens.secrets ?? {}), registrationPin: pin } } : {}),
  };
}

export const integrationRedirectUri = (provider: string) => `${env().APP_URL}/api/v1/integrations/oauth/${provider}/callback`;

function toTokenSet(provider: string, body: Record<string, unknown>, previousRefresh: string | null = null): TokenSet {
  // Slack v2 returns the bot token at the top level; Salesforce omits expires_in (session-based, refreshed on 401).
  // Intercom's token endpoint names it "token".
  const accessToken = typeof body.access_token === "string" ? body.access_token : provider === "intercom" && typeof body.token === "string" ? body.token : null;
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
  // Stripe Connect: the connected account id routes Connect webhooks (account field) to this connection.
  if (provider === "stripe") {
    if (typeof body.stripe_user_id === "string") extra.stripeAccountId = body.stripe_user_id;
    if (typeof body.livemode === "boolean") extra.livemode = body.livemode;
    extra.authMode = "connect";
  }
  // Razorpay Partner OAuth: the merchant's account id routes partner webhooks (account_id) to this connection.
  if (provider === "razorpay") {
    if (typeof body.razorpay_account_id === "string") extra.razorpayAccountId = body.razorpay_account_id;
    extra.authMode = "oauth";
  }
  // B33 providers that also have an API-key setup: their OAuth tokens authenticate differently (authHeaders).
  if (["calendly", "zendesk", "intercom", "shopify", "notion", "webflow", "clickup"].includes(provider)) extra.authMode = "oauth";
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

export async function exchangeCode(provider: string, code: string, verifier: string | null, params: Record<string, unknown> = {}): Promise<TokenSet> {
  const def = oauthDef(provider, params);
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

export async function refreshAccessToken(provider: string, refreshToken: string, config: Record<string, unknown> = {}): Promise<TokenSet> {
  const def = oauthDef(provider, config);
  const client = oauthClient(provider);
  if (!def || !client) throw new ProviderError("provider not configured");
  if (def.refresh) return def.refresh(refreshToken, client);
  const auth = clientAuth(def, client);
  const r = await postForm(def.tokenUrl, { grant_type: "refresh_token", refresh_token: refreshToken, ...auth.form }, auth.headers);
  if (!r.ok || r.body.ok === false) throw new ProviderError(`token refresh failed (${r.status})`, r.status);
  return toTokenSet(provider, r.body, refreshToken);
}

export async function revokeToken(provider: string, token: string, config: Record<string, unknown> = {}): Promise<boolean> {
  const def = oauthDef(provider, config);
  const client = oauthClient(provider);
  if (!def?.revoke || !client) return false;
  await def.revoke(token, client, config);
  return true;
}

/** fetch() for a customer-configured host (SSRF guard, core/outbound): a refused target is a 400 ProviderError. */
async function customFetch(url: string, init: GuardedInit): Promise<Response> {
  try {
    return await guardedFetch(url, init);
  } catch (err) {
    if (err instanceof OutboundBlockedError) throw new ProviderError(`${err.message}`, 400);
    throw err;
  }
}

async function getJson(url: string, headers: Record<string, string>, customerHost = false): Promise<Record<string, unknown>> {
  const init = { headers: { accept: "application/json", "user-agent": "Realy", ...headers }, signal: AbortSignal.timeout(TIMEOUT) };
  const res = customerHost ? await customFetch(url, init) : await fetch(url, init);
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
export const NOTION_API_VERSION = "2022-06-28";
export const INTERCOM_API_VERSION = "2.11";
export const PLAID_API_VERSION = "2020-09-14";

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** Kling API token: an HS256 JWT (iss = access key, 30 minutes) signed with the secret key, minted per request. */
export function klingJwt(accessKey: string, secretKey: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: accessKey, exp: nowSeconds + 1800, nbf: nowSeconds - 5 }));
  const sig = createHmac("sha256", secretKey).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** Kling API base URL (configured regional host or the global Singapore endpoint). */
export const klingBase = (config: Record<string, unknown>) => (str(config.baseUrl) ?? "https://api-singapore.klingai.com").replace(/\/+$/, "");

/** Plaid API host for the connection's environment. */
export const plaidHost = (config: Record<string, unknown>) => (config.environment === "production" ? "https://production.plaid.com" : "https://sandbox.plaid.com");

/** Wise API host for the connection's environment. */
export const wiseHost = (config: Record<string, unknown>) => (config.environment === "sandbox" ? "https://api.sandbox.transferwise.tech" : "https://api.wise.com");

/** Shotstack Edit API base for the connection's environment ("stage" sandbox or "v1" production). */
export const shotstackBase = (config: Record<string, unknown>) => `https://api.shotstack.io/edit/${config.environment === "v1" ? "v1" : "stage"}`;

/** Zendesk API base of the connection's subdomain (validated: it is interpolated into URLs). */
export function zendeskBase(config: Record<string, unknown>): string | null {
  const sub = str(config.subdomain);
  return sub && /^[a-z0-9][a-z0-9-]{0,62}$/.test(sub) ? `https://${sub}.zendesk.com/api/v2` : null;
}

/** OpenAI-compatible base URL of a connection (no trailing slash). */
export const compatibleBase = (provider: string, config: Record<string, unknown>) =>
  provider === "openrouter" ? "https://openrouter.ai/api/v1" : provider === "openai" ? "https://api.openai.com/v1" : (str(config.baseUrl) ?? "").replace(/\/+$/, "");

/** SIP trunk check: the host must resolve to a public address (credentials can only be proven by a real call). */
async function resolvePublicHost(host: string): Promise<string> {
  if (isIP(host)) throw new ProviderError("enter the carrier's SIP domain, not an IP address");
  const addrs = await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new ProviderError(`${host} does not resolve`, 404);
  const pub = addrs.find((a) => !isPrivateAddress(a.address));
  if (!pub) throw new ProviderError(`${host} resolves only to private addresses`, 400);
  return pub.address;
}

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
      // Partner OAuth tokens are bearer tokens; a key id / secret set up by the Realy team uses Basic auth.
      return config.authMode === "oauth" ? bearer : { authorization: `Basic ${b64(`${str(config.keyId) ?? ""}:${token}`)}` };
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
    case "openrouter":
      return { ...bearer, "x-title": "Realy", "http-referer": env().APP_URL };
    case "elevenlabs":
      return { "xi-api-key": token };
    case "deepgram":
      return { authorization: `Token ${token}` };
    case "shotstack":
      return { "x-api-key": token };
    case "kling":
      return { authorization: `Bearer ${klingJwt(str(config.accessKey) ?? "", token)}` };
    case "twilio_voice":
      return { authorization: `Basic ${b64(`${str(config.accountSid) ?? ""}:${token}`)}` };
    case "pipedrive":
      return { "x-api-token": token };
    case "notion":
      return { ...bearer, "notion-version": NOTION_API_VERSION };
    case "clickup":
      // Personal and OAuth tokens alike go in the Authorization header as-is.
      return { authorization: token };
    case "zendesk":
      // OAuth access tokens are bearer tokens; an API token uses Basic "<email>/token:<token>".
      return config.authMode === "oauth" ? bearer : { authorization: `Basic ${b64(`${str(config.email) ?? ""}/token:${token}`)}` };
    case "intercom":
      return { ...bearer, "intercom-version": INTERCOM_API_VERSION };
    case "plaid":
      return { "plaid-client-id": str(config.clientId) ?? "", "plaid-secret": token, "plaid-version": PLAID_API_VERSION };
    // The URL itself is the credential (automation catch hooks); SIP trunks are not HTTP APIs.
    case "zapier":
    case "make":
    case "n8n":
    case "sip_trunk":
      return {};
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
      const id = str(acct.id);
      return { account: str(settings?.dashboard?.display_name) ?? str(acct.email) ?? id ?? "Stripe", extra: id && /^acct_[A-Za-z0-9]{6,64}$/.test(id) ? { stripeAccountId: id } : undefined };
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
      const res = await customFetch(url, { headers: { accept: "application/json", "user-agent": "Realy", ...authHeaders(provider, token, config) }, signal: AbortSignal.timeout(TIMEOUT), redirect: "manual" });
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
      const u = await getJson(`${site.replace(/\/+$/, "")}/wp-json/wp/v2/users/me?context=edit`, authHeaders(provider, token, config), true);
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
      if (config.authMode === "oauth") return { account: `Razorpay · ${str(config.razorpayAccountId) ?? "connected account"}` };
      const keyId = str(config.keyId) ?? "";
      return { account: `Razorpay · ${keyId.startsWith("rzp_test_") ? "test" : "live"} mode` };
    }
    case "s3": {
      const target = s3TargetOf(config, token);
      if (!target) throw new ProviderError("bucket, region or access key missing");
      const url = objectUrl(target);
      const head = { method: "HEAD", headers: signS3Request(target, { method: "HEAD", url }), signal: AbortSignal.timeout(TIMEOUT) };
      const res = target.endpoint ? await customFetch(url.toString(), { ...head, redirect: "manual" }) : await fetch(url, head);
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
    case "openrouter": {
      const u = await getJson("https://openrouter.ai/api/v1/key", authHeaders(provider, token, config));
      const d = (u.data ?? {}) as { label?: string; limit?: number | null; usage?: number; is_free_tier?: boolean };
      return { account: `OpenRouter · ${str(d.label) ?? "key"}`, extra: { creditLimitUsd: typeof d.limit === "number" ? d.limit : null, usageUsd: typeof d.usage === "number" ? d.usage : null } };
    }
    case "openai_compatible": {
      const base = compatibleBase(provider, config);
      if (!base) throw new ProviderError("base URL missing");
      const u = await getJson(`${base}/models`, bearer, true);
      const models = Array.isArray(u.data) ? (u.data as { id?: string }[]) : [];
      const model = str(config.model);
      if (model && models.length && !models.some((m) => m.id === model)) throw new ProviderError(`the API does not list the model ${model}`, 404);
      return { account: `${new URL(base).host} · ${models.length} models` };
    }
    case "elevenlabs": {
      const u = await getJson("https://api.elevenlabs.io/v1/user/subscription", authHeaders(provider, token, config));
      const used = typeof u.character_count === "number" ? u.character_count : null;
      const limit = typeof u.character_limit === "number" ? u.character_limit : null;
      return { account: `ElevenLabs · ${str(u.tier) ?? "plan"}`, extra: { charactersUsed: used, characterLimit: limit } };
    }
    case "deepgram": {
      const u = await getJson("https://api.deepgram.com/v1/projects", authHeaders(provider, token, config));
      const projects = Array.isArray(u.projects) ? (u.projects as { project_id?: string; name?: string }[]) : [];
      if (!projects.length) throw new ProviderError("the key has no Deepgram project", 403);
      return { account: str(projects[0]!.name) ?? "Deepgram", extra: { projectId: projects[0]!.project_id ?? null } };
    }
    case "jamendo": {
      const u = await getJson(`https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(token)}&limit=1&format=json`, {});
      const h = (u.headers ?? {}) as { status?: string; error_message?: string };
      if (h.status && h.status !== "success") throw new ProviderError(`Jamendo: ${h.error_message || h.status}`, 401);
      return { account: "Jamendo · client id" };
    }
    case "luma": {
      await getJson("https://api.lumalabs.ai/dream-machine/v1/generations?limit=1", bearer);
      return { account: "Luma Dream Machine" };
    }
    case "kling": {
      const access = str(config.accessKey);
      if (!access) throw new ProviderError("access key missing");
      const res = await fetch(`${klingBase(config)}/v1/videos/text2video?pageNum=1&pageSize=1`, { headers: { accept: "application/json", ...authHeaders(provider, token, config) }, signal: AbortSignal.timeout(TIMEOUT) });
      const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
      if (!res.ok || (typeof body.code === "number" && body.code !== 0)) throw new ProviderError(`Kling rejected the keys: ${body.message ?? res.status}`, res.ok ? 401 : res.status);
      return { account: `Kling · ${new URL(klingBase(config)).host}` };
    }
    case "shotstack": {
      await getJson(`${shotstackBase(config)}/templates`, authHeaders(provider, token, config));
      return { account: `Shotstack · ${config.environment === "v1" ? "production" : "sandbox"}` };
    }
    case "creatomate": {
      const res = await fetch("https://api.creatomate.com/v1/templates", { headers: { accept: "application/json", ...bearer }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) throw new ProviderError(`api.creatomate.com responded ${res.status}`, res.status);
      const list = (await res.json().catch(() => [])) as unknown[];
      return { account: `Creatomate · ${Array.isArray(list) ? list.length : 0} templates` };
    }
    case "twilio_voice": {
      const sid = str(config.accountSid);
      if (!sid || !/^AC[a-f0-9]{32}$/.test(sid)) throw new ProviderError("account SID missing");
      const h = authHeaders(provider, token, config);
      const u = await getJson(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, h);
      if (str(u.status) && u.status !== "active") throw new ProviderError(`Twilio account is ${String(u.status)}`, 403);
      const nums = await getJson(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=100`, h).catch(() => ({}) as Record<string, unknown>);
      const accounts = (Array.isArray(nums.incoming_phone_numbers) ? nums.incoming_phone_numbers : [])
        .map((n) => n as { sid?: string; phone_number?: string; friendly_name?: string; capabilities?: { voice?: boolean } })
        .filter((n) => n.sid && n.phone_number && n.capabilities?.voice !== false)
        .map((n) => ({ id: n.phone_number!, name: n.friendly_name && n.friendly_name !== n.phone_number ? `${n.phone_number} · ${n.friendly_name}` : n.phone_number!, type: "number" }));
      return { account: `${str(u.friendly_name) ?? sid} · ${accounts.length} voice numbers`, extra: { accounts } };
    }
    case "sip_trunk": {
      const host = str(config.sipDomain);
      if (!host) throw new ProviderError("SIP domain missing");
      await resolvePublicHost(host);
      return { account: `sip:${str(config.username) ?? "user"}@${host}`, extra: { verification: "config_only" } };
    }
    case "pipedrive": {
      const u = await getJson("https://api.pipedrive.com/v1/users/me", authHeaders(provider, token, config));
      const d = (u.data ?? {}) as { name?: string; email?: string; company_name?: string; company_domain?: string };
      return { account: [str(d.company_name), str(d.email)].filter(Boolean).join(" · ") || "Pipedrive", extra: d.company_domain ? { companyDomain: d.company_domain } : undefined };
    }
    case "notion": {
      const u = await getJson("https://api.notion.com/v1/users/me", authHeaders(provider, token, config));
      const bot = (u.bot ?? {}) as { workspace_name?: string };
      return { account: str(bot.workspace_name) ?? str(u.name) ?? "Notion" };
    }
    case "clickup": {
      const h = authHeaders(provider, token, config);
      const u = await getJson("https://api.clickup.com/api/v2/user", h);
      const teams = await getJson("https://api.clickup.com/api/v2/team", h).catch(() => ({}) as Record<string, unknown>);
      const user = (u.user ?? {}) as { email?: string; username?: string };
      return { account: str(user.email) ?? str(user.username) ?? "ClickUp", extra: { accounts: accountsOf(teams.teams, "workspace") } };
    }
    case "calendly": {
      const u = await getJson("https://api.calendly.com/users/me", bearer);
      const r = (u.resource ?? {}) as { name?: string; email?: string; uri?: string; current_organization?: string; scheduling_url?: string };
      if (!r.uri) throw new ProviderError("Calendly returned no user", 401);
      return { account: str(r.email) ?? str(r.name) ?? "Calendly", extra: { userUri: r.uri, organizationUri: r.current_organization ?? null, schedulingUrl: r.scheduling_url ?? null } };
    }
    case "google_drive": {
      const u = await getJson("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName),storageQuota(limit,usage)", bearer);
      const user = (u.user ?? {}) as { emailAddress?: string; displayName?: string };
      return { account: str(user.emailAddress) ?? str(user.displayName) ?? "Google Drive" };
    }
    case "zendesk": {
      const base = zendeskBase(config);
      if (!base) throw new ProviderError("Zendesk subdomain missing");
      const u = await getJson(`${base}/users/me.json`, authHeaders(provider, token, config));
      const user = (u.user ?? {}) as { email?: string; role?: string; id?: number | null };
      // Zendesk answers bad credentials with an anonymous end-user instead of 401.
      if (!user.id || user.role === "end-user") throw new ProviderError("Zendesk did not accept the email / API token", 401);
      return { account: `${str(config.subdomain)}.zendesk.com · ${str(user.email) ?? "agent"}` };
    }
    case "intercom": {
      const u = await getJson("https://api.intercom.io/me", authHeaders(provider, token, config));
      const app = (u.app ?? {}) as { name?: string; id_code?: string };
      return { account: str(app.name) ?? str(u.email) ?? "Intercom", extra: app.id_code ? { appId: app.id_code } : undefined };
    }
    case "plaid": {
      if (!str(config.clientId)) throw new ProviderError("client id missing");
      await postJsonChecked(`${plaidHost(config)}/institutions/get`, authHeaders(provider, token, config), { count: 1, offset: 0, country_codes: plaidCountries(config) });
      return { account: `Plaid · ${config.environment === "production" ? "production" : "sandbox"}` };
    }
    case "wise": {
      const res = await fetch(`${wiseHost(config)}/v2/profiles`, { headers: { accept: "application/json", ...bearer }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) throw new ProviderError(`Wise responded ${res.status}`, res.status);
      const profiles = (await res.json().catch(() => [])) as { id?: number; type?: string; fullName?: string; businessName?: string }[];
      const accounts = (Array.isArray(profiles) ? profiles : []).filter((p) => p.id).map((p) => ({ id: String(p.id), name: p.businessName ?? p.fullName ?? `${p.type ?? "profile"} ${p.id}`, type: (p.type ?? "profile").toLowerCase() }));
      const business = accounts.find((a) => a.type === "business") ?? accounts[0];
      return { account: business?.name ?? "Wise", extra: { accounts } };
    }
    case "zapier":
    case "make":
    case "n8n": {
      // Catch hooks have no identity endpoint: send one clearly labelled test event (what Zapier / Make / n8n ask for when wiring a trigger).
      const body = JSON.stringify({ event: "realy.connection_test", sentAt: new Date().toISOString(), data: { message: "Realy connection test — safe to ignore" } });
      const sig = str(config.signingSecret);
      const ts = Math.floor(Date.now() / 1000);
      const res = await customFetch(token, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Realy", ...(sig ? { "x-realy-signature": `t=${ts},v1=${createHmac("sha256", sig).update(`${ts}.${body}`).digest("hex")}` } : {}) },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!res.ok) throw new ProviderError(`${new URL(token).host} responded ${res.status}`, res.status === 404 || res.status === 410 ? 401 : res.status);
      return { account: `${new URL(token).host} · test event delivered` };
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

/** Plaid Link / institution country codes of a connection (default US). */
export function plaidCountries(config: Record<string, unknown>): string[] {
  const v = str(config.countryCodes);
  return v && /^[A-Z]{2}(,[A-Z]{2}){0,11}$/.test(v) ? v.split(",") : ["US"];
}

export function requireProvider(key: string): ProviderInfo {
  const info = providerInfo(key);
  if (!info) throw new ProviderError("unknown provider");
  return info;
}
