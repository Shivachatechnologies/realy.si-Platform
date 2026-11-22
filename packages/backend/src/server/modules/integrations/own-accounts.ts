import "server-only";
import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { isOwnAccountProvider, OWN_ACCOUNT_PROVIDERS, ownAccountSetupFields, providerInfo, SETUP_BY_REALY, type OwnAccountProvider } from "./catalog";
import { asConfig, decryptCredentials, encryptCredentials } from "./connections";
import { ProviderError, testConnection } from "./providers";

/**
 * The customer's OWN payment, WhatsApp and Mailchimp accounts (docs/integrations.md §7 "Customer's own accounts").
 *
 *  - Routing: Realy's platform apps receive one webhook stream for every connected customer (Stripe Connect, Razorpay
 *    Partner, Meta app). Each event names the account it belongs to — Stripe `account`, Razorpay `account_id`, WhatsApp
 *    `metadata.phone_number_id` — and is routed to the company whose connection stores that id in its (non-secret)
 *    config. No schema change: the ids live in `integration_connections.config`.
 *  - Admin setup (fallback): the Realy team stores an organization's own credentials from the admin app. The caller
 *    (modules/admin/org-integrations.ts) authorizes the platform permission (MFA-gated) and supplies the audit reason;
 *    secrets are verified with the provider's connection test, encrypted, and never returned.
 */

type RoutedRow = { id: string; organizationId: string; companyId: string; provider: string; connectedById: string; credentialsEnc: string | null; config: Prisma.JsonValue };

const routedSelect = { id: true, organizationId: true, companyId: true, provider: true, connectedById: true, credentialsEnc: true, config: true } as const;

/** Active connections of `provider` whose config `key` equals `value` (JSON path filter on the config column). */
async function connectionsByConfig(provider: OwnAccountProvider, key: string, value: string): Promise<RoutedRow[]> {
  return db().integrationConnection.findMany({
    where: { provider, status: { in: ["CONNECTED", "ERROR"] }, credentialsEnc: { not: null }, config: { path: [key], equals: value } },
    select: routedSelect,
    orderBy: { connectedAt: "asc" },
    take: 20,
  });
}

export const STRIPE_ACCOUNT_ID = /^acct_[A-Za-z0-9]{6,64}$/;
export const RAZORPAY_ACCOUNT_ID = /^acc_[A-Za-z0-9]{6,64}$/;
export const WHATSAPP_PHONE_NUMBER_ID = /^\d{5,25}$/;

/**
 * Connections of a Stripe connected account. One Stripe account may be connected by several companies of the same
 * customer (each was authorized by the account owner), so every match receives the event.
 */
export async function connectionsForStripeAccount(accountId: string): Promise<RoutedRow[]> {
  if (!STRIPE_ACCOUNT_ID.test(accountId)) return [];
  return connectionsByConfig("stripe", "stripeAccountId", accountId);
}

/** Connections of a Razorpay merchant account (partner webhooks carry account_id). */
export async function connectionsForRazorpayAccount(accountId: string): Promise<RoutedRow[]> {
  if (!RAZORPAY_ACCOUNT_ID.test(accountId)) return [];
  return connectionsByConfig("razorpay", "razorpayAccountId", accountId);
}

/** The single connection of a WhatsApp phone number (phone_number_id is unique per active connection, see below). */
export async function connectionForPhoneNumberId(phoneNumberId: string): Promise<RoutedRow | null> {
  if (!WHATSAPP_PHONE_NUMBER_ID.test(phoneNumberId)) return null;
  const rows = await connectionsByConfig("whatsapp", "phoneNumberId", phoneNumberId);
  if (rows.length > 1) logger.error({ phoneNumberId, connections: rows.length }, "whatsapp phone number id is attached to several connections; routing to none");
  return rows.length === 1 ? rows[0]! : null;
}

/**
 * A WhatsApp phone number belongs to one company: connecting a number another company already uses is refused, so
 * inbound messages and statuses can never be routed to the wrong tenant.
 */
export async function assertWhatsAppNumberFree(companyId: string, phoneNumberId: unknown): Promise<void> {
  if (typeof phoneNumberId !== "string" || !WHATSAPP_PHONE_NUMBER_ID.test(phoneNumberId)) return;
  const taken = await db().integrationConnection.findFirst({
    where: { provider: "whatsapp", companyId: { not: companyId }, status: { in: ["CONNECTED", "ERROR"] }, config: { path: ["phoneNumberId"], equals: phoneNumberId } },
    select: { id: true },
  });
  if (taken) throw conflict("This WhatsApp phone number is already connected to another company in Realy", { reason: "integrations_whatsapp_number_taken" });
}

/**
 * The provider removed Realy's access (Stripe account.application.deauthorized, Razorpay authorization revoked): the
 * connection is marked DISCONNECTED and its credentials wiped (nothing else is deleted), audited as the system.
 */
export async function markDeauthorized(ctx: RequestContext, row: Pick<RoutedRow, "id" | "organizationId" | "companyId" | "provider">, event: string): Promise<void> {
  await transaction(async (tx) => {
    const updated = await tx.integrationConnection.updateMany({
      where: { id: row.id, status: { not: "DISCONNECTED" } },
      data: { status: "DISCONNECTED", credentialsEnc: null, tokenExpiresAt: null, syncEnabled: false, nextSyncAt: null, syncCursor: {}, lastError: `Access was removed at ${row.provider} (${event})`.slice(0, 500), lastErrorAt: new Date() },
    });
    if (updated.count) await writeAudit(tx, ctx, { category: "TENANT", organizationId: row.organizationId, action: "integration.deauthorized", resourceType: "integration_connection", resourceId: row.id, newValue: { provider: row.provider, event } });
  });
}

// ───────────────────────────── Admin setup (Realy team) ─────────────────────────────

const MAX_FIELD = 4000;
export const adminCredentialsInput = z.object({
  companyId: z.string().uuid(),
  fields: z.record(z.string().max(64), z.string().max(MAX_FIELD)),
});

/** Safe status of an organization's own-account connections (never credentials), per company and provider. */
export async function ownAccountStatus(organizationId: string) {
  const [companies, rows] = await Promise.all([
    db().company.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" }, take: 50 }),
    db().integrationConnection.findMany({
      where: { organizationId, provider: { in: [...OWN_ACCOUNT_PROVIDERS] } },
      select: { id: true, companyId: true, provider: true, status: true, externalAccount: true, config: true, lastError: true, lastTestedAt: true, connectedAt: true, updatedAt: true },
    }),
  ]);
  return companies.map((c) => ({
    company: c,
    providers: OWN_ACCOUNT_PROVIDERS.map((p) => {
      const r = rows.find((x) => x.companyId === c.id && x.provider === p) ?? null;
      const active = r && r.status !== "DISCONNECTED" ? r : null;
      const cfg = active ? asConfig(active.config) : {};
      return {
        provider: p,
        connectionId: active?.id ?? null,
        status: active?.status ?? null,
        account: active?.externalAccount ?? null,
        lastError: active?.lastError ?? null,
        lastTestedAt: active?.lastTestedAt ?? null,
        connectedAt: active?.connectedAt ?? null,
        /** "realy_team" (admin setup) or "customer" (the customer's own Connect login). */
        setupBy: active ? (cfg.setupBy === SETUP_BY_REALY ? "realy_team" : "customer") : null,
      };
    }),
  }));
}

/**
 * Store (or rotate) an organization's own credentials for an own-account provider on behalf of the Realy team.
 * Caller: modules/admin/org-integrations.ts, after authorizing a platform permission inside the admin MFA perimeter.
 * Fields are validated against the catalog, verified with the provider's connection test (nothing is stored when the
 * provider rejects them), encrypted, and never returned: the result is the safe status only.
 */
export async function storeOwnAccountCredentials(
  actor: RequestContext,
  organizationId: string,
  provider: string,
  raw: z.input<typeof adminCredentialsInput>,
  reason: string,
): Promise<{ connectionId: string; status: string; account: string | null; rotated: boolean }> {
  if (!isOwnAccountProvider(provider)) throw notFound("Integration");
  const info = providerInfo(provider)!;
  const { companyId, fields } = adminCredentialsInput.parse(raw);
  const company = await db().company.findFirst({ where: { id: companyId, organizationId }, select: { id: true } });
  if (!company) throw notFound("Company");

  const issues: { path: string; message: string }[] = [];
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  let apiKey: string | null = null;
  for (const f of ownAccountSetupFields(info)) {
    const v = typeof fields[f.key] === "string" ? fields[f.key]!.trim() : "";
    if (!v) {
      if (f.required) issues.push({ path: f.key, message: "Required" });
      continue;
    }
    if (v.length > MAX_FIELD || (f.pattern && !new RegExp(f.pattern).test(v))) {
      issues.push({ path: f.key, message: "Invalid value" });
      continue;
    }
    if (f.key === "apiKey") apiKey = v;
    else if (f.secret) secrets[f.key] = v;
    else config[f.key] = v;
  }
  if (issues.length) throw new AppError("validation_error", "Invalid credentials", { issues });
  if (!apiKey) throw invalid("API key required");
  const authMode = provider === "mailchimp" || provider === "razorpay" ? { authMode: "key" } : {};
  if (provider === "whatsapp") await assertWhatsAppNumberFree(companyId, config.phoneNumberId);

  let account: string | null = null;
  let extra: Record<string, unknown> = {};
  try {
    const r = await testConnection({ provider, token: apiKey, config: { ...config, ...authMode, ...secrets } });
    account = r.account;
    extra = r.extra ?? {};
  } catch (err) {
    throw invalid("The provider rejected these credentials", { reason: "integrations_test_failed", status: err instanceof ProviderError ? err.status : null, detail: err instanceof ProviderError ? err.message.slice(0, 200) : null });
  }
  const accounts = Array.isArray(extra.accounts) ? (extra.accounts as { id: string }[]) : null;
  const nextConfig: Record<string, unknown> = { ...config, ...authMode, ...extra, ...(accounts ? { activeAccountId: accounts[0]?.id ?? null } : {}), setupBy: SETUP_BY_REALY };
  const existing = await db().integrationConnection.findFirst({ where: { organizationId, companyId, provider }, select: { id: true, status: true, credentialsEnc: true } });
  const rotated = !!existing && existing.status !== "DISCONNECTED";
  // A rotation keeps secrets the provider issued at connect time (e.g. a WhatsApp registration PIN).
  const previousSecrets = rotated ? (decryptCredentials(companyId, provider, existing!.credentialsEnc).secrets ?? {}) : {};
  const allSecrets = { ...previousSecrets, ...secrets };
  return transaction(async (tx) => {
    const data = {
      status: "CONNECTED" as const,
      credentialsEnc: encryptCredentials(companyId, provider, { apiKey, ...(Object.keys(allSecrets).length ? { secrets: allSecrets } : {}) }),
      tokenExpiresAt: null,
      scopes: [],
      config: nextConfig as Prisma.InputJsonValue,
      externalAccount: account,
      lastError: null,
      lastErrorAt: null,
      lastTestedAt: new Date(),
      lastSuccessAt: new Date(),
      errorStreak: 0,
      connectedById: actor.actor.id ?? organizationId,
      connectedAt: new Date(),
      syncEnabled: !!info.syncKinds?.length,
      nextSyncAt: info.syncKinds?.length ? new Date() : null,
    };
    const row = await tx.integrationConnection.upsert({
      where: { companyId_provider: { companyId, provider } },
      create: { organizationId, companyId, provider, ...data },
      update: data,
      select: { id: true, status: true },
    });
    // Field names only — never values.
    await writeAudit(tx, actor, {
      category: "ADMIN",
      organizationId,
      action: rotated ? "platform.integration_credentials_rotated" : "platform.integration_credentials_set",
      resourceType: "integration_connection",
      resourceId: row.id,
      newValue: { provider, companyId, account, fields: Object.keys(fields).filter((k) => fields[k]?.trim()).sort(), setupBy: SETUP_BY_REALY },
      reason,
    });
    return { connectionId: row.id, status: row.status, account, rotated };
  });
}
