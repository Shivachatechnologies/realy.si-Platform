import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, notFound } from "@/server/core/errors";
import { pageInput, prismaPage, toPage } from "@/server/core/pagination";
import { hasTenantViewGrant } from "./tenants";
import { isOwnAccountProvider } from "@/server/modules/integrations/catalog";
import { adminCredentialsInput, ownAccountStatus, storeOwnAccountCredentials } from "@/server/modules/integrations/own-accounts";
import { isUuid, reasonSchema, requireAnyPlatform } from "./access";
import { writeAudit } from "@/server/modules/audit/service";
import { disconnectIntegration } from "@/server/modules/integrations/service";

/**
 * Realy-team setup of an organization's OWN accounts (docs/integrations.md §7, fallback when the customer cannot use
 * "Connect with X"): Stripe restricted key, Razorpay key id / secret, WhatsApp permanent token + phone number id,
 * Mailchimp API key. Inside the admin MFA perimeter: both permissions are MFA-gated, so requirePermission also enforces
 * a fresh MFA verification. Every change carries a reason (audit log, field names only); secrets are validated with the
 * provider's own connection test, stored encrypted, and never returned. The user app shows "Set up by Realy team".
 */

/** Platform permissions allowed to set, rotate or remove an organization's own credentials (both MFA-gated). */
export const OWN_ACCOUNT_MANAGE = ["platform.controls.manage", "platform.security.manage"];
const READ = ["platform.organizations.read", "platform.security.read", "platform.controls.manage"];

/** Status of the organization's own-account connections per company (no credentials). */
export async function adminOwnAccountStatus(ctx: RequestContext, organizationId: string) {
  await requireAnyPlatform(ctx, READ);
  if (!isUuid(organizationId)) throw notFound("Organization");
  const org = await db().organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } });
  if (!org) throw notFound("Organization");
  return { organization: org, companies: await ownAccountStatus(organizationId) };
}

export const adminOwnAccountInput = adminCredentialsInput.extend({ reason: z.string() });

/** Set up or rotate the organization's own credentials for one provider (verified first; nothing returned but status). */
export async function adminSetOwnAccountCredentials(ctx: RequestContext, organizationId: string, provider: string, raw: z.input<typeof adminOwnAccountInput>) {
  const { reason, ...input } = adminOwnAccountInput.parse(raw);
  const why = reasonSchema.parse(reason);
  await requireAnyPlatform(ctx, OWN_ACCOUNT_MANAGE); // MFA-gated permissions: also enforces a fresh MFA verification
  if (!isUuid(organizationId) || !isOwnAccountProvider(provider)) throw notFound("Integration");
  const org = await db().organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) throw notFound("Organization");
  return storeOwnAccountCredentials(ctx, organizationId, provider, input, why);
}

/** Remove the organization's own credentials (same as the customer's Disconnect), audited with a reason. */
export async function adminRemoveOwnAccount(ctx: RequestContext, organizationId: string, connectionId: string, raw: { reason?: string }) {
  const reason = reasonSchema.parse(raw.reason);
  await requireAnyPlatform(ctx, OWN_ACCOUNT_MANAGE);
  if (!isUuid(organizationId) || !isUuid(connectionId)) throw notFound("Connection");
  const row = await db().integrationConnection.findFirst({ where: { id: connectionId, organizationId }, select: { companyId: true, provider: true, status: true } });
  if (!row || row.status === "DISCONNECTED" || !isOwnAccountProvider(row.provider)) throw notFound("Connection");
  // The integrations service runs as trusted platform code on the admin's behalf (actor id kept for the record).
  const staff: RequestContext = { ...ctx, actor: { type: "SYSTEM", id: ctx.actor.id } };
  const result = await disconnectIntegration(staff, organizationId, row.companyId, row.provider);
  await transaction((tx) =>
    writeAudit(tx, ctx, { category: "ADMIN", organizationId, action: "platform.integration_credentials_removed", resourceType: "integration_connection", resourceId: connectionId, oldValue: { provider: row.provider, companyId: row.companyId, status: row.status }, reason }),
  );
  return result;
}

// ───────────── Integration request log (B34) ─────────────

export const requestLogFilters = pageInput.extend({
  companyId: z.string().uuid().optional().catch(undefined),
  provider: z.string().regex(/^[a-z0-9_]{2,40}$/).optional().catch(undefined),
  /** "errors": no response or HTTP >= 400. */
  outcome: z.enum(["all", "errors"]).default("all").catch("all"),
});

/**
 * The organization's outbound provider calls (IntegrationRequestLog: method, host + path without query, status,
 * duration, attempts, secret-free summaries), newest first, cursor-paginated. Cross-tenant data: needs a platform
 * read permission AND the audited tenant-view grant of this session (opened with a reason on the organization page).
 */
export async function adminIntegrationRequestLogs(ctx: RequestContext, organizationId: string, raw: Record<string, unknown> = {}) {
  await requireAnyPlatform(ctx, READ);
  if (!isUuid(organizationId)) throw notFound("Organization");
  if (!(await hasTenantViewGrant(ctx, organizationId))) throw new AppError("forbidden", "Open the organization with a reason first", { reason: "admin_tenant_view_required" });
  const f = requestLogFilters.parse(raw);
  const where = {
    organizationId,
    ...(f.companyId ? { companyId: f.companyId } : {}),
    ...(f.provider ? { provider: f.provider } : {}),
    ...(f.outcome === "errors" ? { OR: [{ status: null }, { status: { gte: 400 } }] } : {}),
  };
  const [rows, providers, companies] = await Promise.all([
    db().integrationRequestLog.findMany({
      where,
      orderBy: { id: "desc" },
      ...prismaPage(f),
      select: { id: true, companyId: true, connectionId: true, provider: true, method: true, url: true, status: true, durationMs: true, attempts: true, requestSummary: true, responseSummary: true, error: true, createdAt: true },
    }),
    db().integrationRequestLog.findMany({ where: { organizationId }, distinct: ["provider"], select: { provider: true }, take: 100 }),
    db().company.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);
  return { ...toPage(rows, f), filters: f, providers: providers.map((p) => p.provider).sort(), companies };
}
