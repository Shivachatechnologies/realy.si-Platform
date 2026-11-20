import { createHash } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { env } from "@/server/core/env";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { decryptSecret, encryptSecret, randomToken, safeEqual } from "@/server/core/crypto";
import { securityEvent } from "@/server/core/telemetry";
import { writeAudit } from "@/server/modules/audit/service";
import { createSession } from "@/server/modules/auth/session";
import { closestLocale } from "@/i18n/config";
import { authorizeOrg, getOrgSettings, setEnforceSso } from "./policy";

/**
 * Enterprise SSO. OIDC sign-in (authorization code + PKCE S256, state and nonce in an encrypted 10-minute cookie)
 * signs in an EXISTING active member whose email domain the organization verified via DNS TXT. It never creates users
 * or links accounts. SAML connections are stored (metadata, entity id, SSO URL) but cannot sign anyone in until a SAML
 * library is added.
 */

export const SSO_COOKIE = "realy_sso";
const SECRET_PURPOSE = "sso.client_secret";
const STATE_PURPOSE = "sso.state";
const STATE_TTL_MS = 10 * 60 * 1000;
export const TXT_PREFIX = "realy-verification=";

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Enter a domain like example.com");

export const domainInput = z.object({ domain: domainSchema });
export const connectionInput = z.discriminatedUnion("protocol", [
  z.object({
    protocol: z.literal("OIDC"),
    name: z.string().trim().min(1).max(80),
    issuer: z.string().trim().url().max(300),
    clientId: z.string().trim().min(1).max(300),
    clientSecret: z.string().min(1).max(500),
  }),
  z.object({
    protocol: z.literal("SAML"),
    name: z.string().trim().min(1).max(80),
    samlMetadataXml: z.string().max(200_000).optional(),
    samlEntityId: z.string().trim().max(500).optional(),
    samlSsoUrl: z.string().trim().url().max(500).optional(),
  }),
]);
export const connectionPatchInput = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  clientSecret: z.string().min(1).max(500).optional(),
});
export const enforceInput = z.object({ enforceSso: z.boolean() });

export const emailDomain = (email: string) => email.trim().toLowerCase().split("@")[1] ?? "";

export async function ssoOverview(ctx: RequestContext, organizationId: string) {
  await authorizeOrg(ctx, organizationId, "organizations.read");
  const [connections, domains, settings] = await Promise.all([
    db().enterpriseSsoConnection.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    }),
    db().enterpriseSsoDomain.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    }),
    getOrgSettings(organizationId),
  ]);
  return {
    connections: connections.map(({ clientSecretEncrypted, samlMetadataXml, ...c }) => ({
      ...c,
      hasSecret: !!clientSecretEncrypted,
      hasMetadata: !!samlMetadataXml,
    })),
    domains,
    enforceSso: settings.enforceSso,
    redirectUri: callbackUrl(),
  };
}

export const callbackUrl = () => `${env().APP_URL}/api/v1/sso/oidc/callback`;

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

async function discover(issuer: string): Promise<Discovery> {
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok)
    throw invalid("Could not read the issuer's OpenID configuration", {
      reason: "enterprise_oidc_discovery_failed",
    });
  const d = (await res.json().catch(() => ({}))) as Partial<Discovery>;
  if (!d.authorization_endpoint || !d.token_endpoint || !d.userinfo_endpoint)
    throw invalid("The issuer's OpenID configuration is incomplete", {
      reason: "enterprise_oidc_discovery_failed",
    });
  for (const u of [d.authorization_endpoint, d.token_endpoint, d.userinfo_endpoint])
    if (!u.startsWith("https://") && env().NODE_ENV === "production") throw invalid("Endpoints must use HTTPS");
  return d as Discovery;
}

export async function createConnection(ctx: RequestContext, organizationId: string, raw: z.input<typeof connectionInput>) {
  const input = connectionInput.parse(raw);
  return transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "organizations.manage", tx);
    const c = await tx.enterpriseSsoConnection.create({
      data:
        input.protocol === "OIDC"
          ? {
              organizationId,
              protocol: "OIDC",
              name: input.name,
              issuer: input.issuer.replace(/\/$/, ""),
              clientId: input.clientId,
              clientSecretEncrypted: encryptSecret(input.clientSecret, SECRET_PURPOSE),
              createdById: ctx.actor.id ?? organizationId,
            }
          : {
              organizationId,
              protocol: "SAML",
              name: input.name,
              samlMetadataXml: input.samlMetadataXml ?? null,
              samlEntityId: input.samlEntityId ?? null,
              samlSsoUrl: input.samlSsoUrl ?? null,
              createdById: ctx.actor.id ?? organizationId,
            },
    });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "sso.connection_created",
      resourceType: "sso_connection",
      resourceId: c.id,
      newValue: { protocol: c.protocol, name: c.name, issuer: c.issuer },
    });
    return { id: c.id };
  });
}

export async function updateConnection(ctx: RequestContext, organizationId: string, connectionId: string, raw: z.input<typeof connectionPatchInput>) {
  const input = connectionPatchInput.parse(raw);
  if (!z.string().uuid().safeParse(connectionId).success) throw notFound("Connection");
  const c = await db().enterpriseSsoConnection.findFirst({
    where: { id: connectionId, organizationId },
  });
  if (!c) throw notFound("Connection");
  if (input.enabled && c.protocol === "SAML") throw invalid("SAML sign-in needs a SAML library and is not available yet", { reason: "enterprise_saml_unavailable" });
  if (input.enabled && c.protocol === "OIDC") await discover(c.issuer!); // validate before enabling (outside the transaction)
  return transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "organizations.manage", tx);
    const updated = await tx.enterpriseSsoConnection.update({
      where: { id: c.id },
      data: {
        enabled: input.enabled,
        name: input.name,
        ...(input.clientSecret
          ? {
              clientSecretEncrypted: encryptSecret(input.clientSecret, SECRET_PURPOSE),
            }
          : {}),
      },
    });
    if (
      input.enabled === false &&
      !(await tx.enterpriseSsoConnection.count({
        where: { organizationId, enabled: true },
      }))
    )
      await setEnforceSso(tx, ctx, organizationId, false);
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "sso.connection_updated",
      resourceType: "sso_connection",
      resourceId: c.id,
      newValue: {
        enabled: input.enabled,
        name: input.name,
        secretRotated: !!input.clientSecret,
      },
    });
    return { id: updated.id, enabled: updated.enabled };
  });
}

export async function deleteConnection(ctx: RequestContext, organizationId: string, connectionId: string) {
  if (!z.string().uuid().safeParse(connectionId).success) throw notFound("Connection");
  await transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "organizations.manage", tx);
    const c = await tx.enterpriseSsoConnection.findFirst({
      where: { id: connectionId, organizationId },
    });
    if (!c) throw notFound("Connection");
    await tx.enterpriseSsoConnection.delete({ where: { id: c.id } });
    if (
      !(await tx.enterpriseSsoConnection.count({
        where: { organizationId, enabled: true },
      }))
    )
      await setEnforceSso(tx, ctx, organizationId, false);
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "sso.connection_deleted",
      resourceType: "sso_connection",
      resourceId: c.id,
      oldValue: { protocol: c.protocol, name: c.name },
    });
  });
}

export async function setSsoEnforcement(ctx: RequestContext, organizationId: string, raw: z.input<typeof enforceInput>) {
  const input = enforceInput.parse(raw);
  await transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "organizations.manage", tx);
    if (input.enforceSso) {
      const [conn, domain] = await Promise.all([
        tx.enterpriseSsoConnection.count({
          where: { organizationId, enabled: true, protocol: "OIDC" },
        }),
        tx.enterpriseSsoDomain.count({
          where: { organizationId, verifiedAt: { not: null } },
        }),
      ]);
      if (!conn || !domain)
        throw invalid("Enable an OIDC connection and verify a domain first", {
          reason: "enterprise_sso_not_ready",
        });
    }
    await setEnforceSso(tx, ctx, organizationId, input.enforceSso);
  });
}

// ───────────── Domains ─────────────

export async function addDomain(ctx: RequestContext, organizationId: string, raw: z.input<typeof domainInput>) {
  const input = domainInput.parse(raw);
  return transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "organizations.manage", tx);
    if (
      await tx.enterpriseSsoDomain.findUnique({
        where: {
          organizationId_domain: { organizationId, domain: input.domain },
        },
      })
    )
      throw conflict("Domain already added");
    const d = await tx.enterpriseSsoDomain.create({
      data: {
        organizationId,
        domain: input.domain,
        verificationToken: randomToken(18),
      },
    });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "sso.domain_added",
      resourceType: "sso_domain",
      resourceId: d.id,
      newValue: { domain: d.domain },
    });
    return d;
  });
}

/** Look for TXT `realy-verification=<token>` on the domain. */
export async function txtRecordPresent(domain: string, token: string): Promise<boolean> {
  try {
    const records = await resolveTxt(domain);
    return records.some((chunks) => chunks.join("").trim() === `${TXT_PREFIX}${token}`);
  } catch {
    return false;
  }
}

export async function verifyDomain(ctx: RequestContext, organizationId: string, domainId: string) {
  if (!z.string().uuid().safeParse(domainId).success) throw notFound("Domain");
  await authorizeOrg(ctx, organizationId, "organizations.manage");
  const d = await db().enterpriseSsoDomain.findFirst({
    where: { id: domainId, organizationId },
  });
  if (!d) throw notFound("Domain");
  const found = await txtRecordPresent(d.domain, d.verificationToken);
  return transaction(async (tx) => {
    if (found) {
      const elsewhere = await tx.enterpriseSsoDomain.findFirst({
        where: {
          domain: d.domain,
          verifiedAt: { not: null },
          organizationId: { not: organizationId },
        },
      });
      if (elsewhere)
        throw conflict("This domain is verified by another organization", {
          reason: "enterprise_domain_claimed",
        });
    }
    const updated = await tx.enterpriseSsoDomain.update({
      where: { id: d.id },
      data: {
        lastCheckedAt: new Date(),
        ...(found ? { verifiedAt: d.verifiedAt ?? new Date() } : {}),
      },
    });
    if (found && !d.verifiedAt)
      await writeAudit(tx, ctx, {
        category: "SECURITY",
        organizationId,
        action: "sso.domain_verified",
        resourceType: "sso_domain",
        resourceId: d.id,
        newValue: { domain: d.domain },
      });
    return { verified: !!updated.verifiedAt, found };
  });
}

export async function removeDomain(ctx: RequestContext, organizationId: string, domainId: string) {
  if (!z.string().uuid().safeParse(domainId).success) throw notFound("Domain");
  await transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "organizations.manage", tx);
    const d = await tx.enterpriseSsoDomain.findFirst({
      where: { id: domainId, organizationId },
    });
    if (!d) throw notFound("Domain");
    await tx.enterpriseSsoDomain.delete({ where: { id: d.id } });
    if (
      !(await tx.enterpriseSsoDomain.count({
        where: { organizationId, verifiedAt: { not: null } },
      }))
    )
      await setEnforceSso(tx, ctx, organizationId, false);
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "sso.domain_removed",
      resourceType: "sso_domain",
      resourceId: d.id,
      oldValue: { domain: d.domain },
    });
  });
}

// ───────────── OIDC sign-in ─────────────

export class SsoError extends Error {
  constructor(readonly code: "no_connection" | "state_mismatch" | "provider_error" | "not_member" | "email_mismatch" | "account_disabled") {
    super(code);
  }
}

/** Organization whose verified domain matches the email and that has an enabled OIDC connection. */
async function connectionForEmail(email: string) {
  const domain = emailDomain(email);
  if (!domain) return null;
  const d = await db().enterpriseSsoDomain.findFirst({
    where: { domain, verifiedAt: { not: null } },
    select: { organizationId: true },
  });
  if (!d) return null;
  const c = await db().enterpriseSsoConnection.findFirst({
    where: {
      organizationId: d.organizationId,
      protocol: "OIDC",
      enabled: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return c ? { connection: c, organizationId: d.organizationId } : null;
}

/**
 * Whether password / social sign-in must be refused for this email because its organization enforces SSO.
 * Hook point: src/server/modules/auth/service.ts sign-in (and OAuth login) should call this and redirect to /sso.
 */
export async function ssoEnforcedFor(email: string): Promise<boolean> {
  const found = await connectionForEmail(email);
  return !!found && (await getOrgSettings(found.organizationId)).enforceSso;
}

interface StatePayload {
  connectionId: string;
  organizationId: string;
  state: string;
  verifier: string;
  nonce: string;
  locale: string;
  exp: number;
}

export async function beginSso(email: string, locale: string) {
  const found = await connectionForEmail(email);
  if (!found) throw new SsoError("no_connection");
  const d = await discover(found.connection.issuer!).catch(() => {
    throw new SsoError("provider_error");
  });
  const payload: StatePayload = {
    connectionId: found.connection.id,
    organizationId: found.organizationId,
    state: randomToken(32),
    verifier: randomToken(48),
    nonce: randomToken(24),
    locale: closestLocale(locale),
    exp: Date.now() + STATE_TTL_MS,
  };
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: found.connection.clientId!,
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: "openid email profile",
    state: payload.state,
    nonce: payload.nonce,
    login_hint: email.trim().toLowerCase(),
    code_challenge: createHash("sha256").update(payload.verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return {
    url: url.toString(),
    cookie: encryptSecret(JSON.stringify(payload), STATE_PURPOSE),
    maxAgeSeconds: STATE_TTL_MS / 1000,
  };
}

export function readSsoState(value: string | undefined, state: string | null): StatePayload {
  if (!value || !state) throw new SsoError("state_mismatch");
  let p: StatePayload;
  try {
    p = JSON.parse(decryptSecret(value, STATE_PURPOSE)) as StatePayload;
  } catch {
    throw new SsoError("state_mismatch");
  }
  if (p.exp < Date.now() || !safeEqual(p.state, state)) {
    securityEvent("sso.state_mismatch", { organizationId: p.organizationId });
    throw new SsoError("state_mismatch");
  }
  return p;
}

/** Exchange the code, read the identity from the issuer's userinfo endpoint over TLS and sign in the member. */
export async function completeSso(ctx: RequestContext, state: StatePayload, code: string) {
  const c = await db().enterpriseSsoConnection.findFirst({
    where: {
      id: state.connectionId,
      organizationId: state.organizationId,
      enabled: true,
      protocol: "OIDC",
    },
  });
  if (!c?.issuer || !c.clientId || !c.clientSecretEncrypted) throw new SsoError("no_connection");
  const d = await discover(c.issuer).catch(() => {
    throw new SsoError("provider_error");
  });
  const tokenRes = await fetch(d.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(),
      client_id: c.clientId,
      client_secret: decryptSecret(c.clientSecretEncrypted, SECRET_PURPOSE),
      code_verifier: state.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const tokens = (await tokenRes?.json().catch(() => ({}))) as { access_token?: string } | undefined;
  if (!tokenRes?.ok || !tokens?.access_token) throw new SsoError("provider_error");
  const infoRes = await fetch(d.userinfo_endpoint, {
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const info = (await infoRes?.json().catch(() => ({}))) as { sub?: string; email?: string; email_verified?: boolean } | undefined;
  if (!infoRes?.ok || !info?.sub || typeof info.email !== "string") throw new SsoError("provider_error");
  if (info.email_verified === false) throw new SsoError("email_mismatch");
  const email = info.email.trim().toLowerCase();
  const verified = await db().enterpriseSsoDomain.findFirst({
    where: {
      organizationId: state.organizationId,
      domain: emailDomain(email),
      verifiedAt: { not: null },
    },
  });
  if (!verified) throw new SsoError("email_mismatch");

  return transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email } });
    if (!user) throw new SsoError("not_member");
    if (user.status !== "ACTIVE") throw new SsoError("account_disabled");
    const member = await tx.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: state.organizationId,
          userId: user.id,
        },
      },
    });
    if (member?.status !== "ACTIVE") throw new SsoError("not_member");
    const { token, session } = await createSession(tx, user.id, {
      mfaPending: user.mfaEnabled,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    await writeAudit(
      tx,
      { ...ctx, actor: { type: "USER", id: user.id } },
      {
        category: "SECURITY",
        organizationId: state.organizationId,
        action: user.mfaEnabled ? "auth.sign_in_mfa_pending" : "auth.sign_in",
        resourceType: "session",
        resourceId: session.id,
        newValue: { via: "sso", connectionId: c.id },
      },
    );
    return {
      token,
      expiresAt: session.expiresAt,
      mfaRequired: user.mfaEnabled,
      organizationId: state.organizationId,
      locale: state.locale,
    };
  });
}
