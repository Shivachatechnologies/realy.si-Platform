import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { decryptSecret, encryptSecret, randomToken, safeEqual } from "@/server/core/crypto";
import { securityEvent } from "@/server/core/telemetry";
import { closestLocale } from "@/i18n/config";
import { providerInfo } from "./catalog";
import { integrationRedirectUri, oauthClient, oauthDef } from "./providers";

/**
 * OAuth 2.0 authorization-code flow for provider connections. PKCE (S256) where the provider supports it, a random
 * `state` echoed by the provider, and the flow context (company, user, verifier) in an encrypted + authenticated
 * (AES-GCM, i.e. signed) HttpOnly cookie that expires after 10 minutes. The callback also requires the same signed-in user.
 */

export const INTEGRATION_OAUTH_COOKIE = "realy_int_oauth";
export const INTEGRATION_OAUTH_COOKIE_PATH = "/api/v1/integrations/oauth";
const TTL_MS = 10 * 60_000;
const PURPOSE = "integrations.oauth.state";

export interface IntegrationOAuthState {
  provider: string;
  state: string;
  verifier: string;
  organizationId: string;
  companyId: string;
  userId: string;
  locale: string;
  exp: number;
}

const stateSchema = z.object({
  provider: z.string(),
  state: z.string(),
  verifier: z.string(),
  organizationId: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  locale: z.string(),
  exp: z.number(),
});

export class IntegrationOAuthError extends Error {
  constructor(readonly code: "not_configured" | "state_mismatch" | "provider_error" | "forbidden") {
    super(code);
  }
}

const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function buildAuthorizeUrl(provider: string, ctx: { organizationId: string; companyId: string; userId: string; locale: string }) {
  const info = providerInfo(provider);
  const def = oauthDef(provider);
  const client = oauthClient(provider);
  if (!info || info.authType !== "oauth2" || !def || !client) throw new IntegrationOAuthError("not_configured");
  const payload: IntegrationOAuthState = {
    provider,
    state: randomToken(32),
    verifier: randomToken(48),
    organizationId: ctx.organizationId,
    companyId: ctx.companyId,
    userId: ctx.userId,
    locale: closestLocale(ctx.locale),
    exp: Date.now() + TTL_MS,
  };
  const url = new URL(def.authorizeUrl);
  const params: Record<string, string> = {
    client_id: client.clientId,
    redirect_uri: integrationRedirectUri(provider),
    response_type: "code",
    scope: info.scopes.join(def.scopeSeparator),
    state: payload.state,
    ...(def.pkce ? { code_challenge: challengeOf(payload.verifier), code_challenge_method: "S256" } : {}),
    ...(def.extraAuthorizeParams ?? {}),
  };
  url.search = new URLSearchParams(params).toString();
  return { url: url.toString(), cookie: encryptSecret(JSON.stringify(payload), PURPOSE), maxAgeSeconds: TTL_MS / 1000 };
}

export function readIntegrationState(cookie: string | undefined, provider: string, state: string | null): IntegrationOAuthState {
  if (!cookie || !state) throw new IntegrationOAuthError("state_mismatch");
  let payload: IntegrationOAuthState;
  try {
    payload = stateSchema.parse(JSON.parse(decryptSecret(cookie, PURPOSE)));
  } catch {
    throw new IntegrationOAuthError("state_mismatch");
  }
  if (payload.provider !== provider || payload.exp < Date.now() || !safeEqual(payload.state, state)) {
    securityEvent("integration_oauth.state_mismatch", { provider });
    throw new IntegrationOAuthError("state_mismatch");
  }
  return payload;
}
