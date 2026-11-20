import { z } from "zod";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { actorId, authorize, isUuid } from "./common";

/**
 * Do-not-contact list of the company's sales outreach. An email address or a whole domain can be suppressed (manually,
 * or automatically on a bounce / complaint / unsubscribe). Every CRM email checks it before sending, together with the
 * company-wide marketing unsubscribe list (MarketingSuppression, written by the one-click unsubscribe link), so an
 * unsubscribe anywhere stops all outreach.
 */

export const SUPPRESSION_REASONS = ["unsubscribed", "bounced", "complaint", "manual", "customer", "competitor", "do_not_contact"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const suppressionInput = z
  .object({
    value: z.string().trim().toLowerCase().min(3).max(254),
    reason: z.enum(SUPPRESSION_REASONS).default("do_not_contact"),
    note: z.string().trim().max(300).optional(),
  })
  .transform((v) => {
    const raw = v.value.replace(/^mailto:/, "").replace(/^@/, "");
    const kind = raw.includes("@") ? ("EMAIL" as const) : ("DOMAIN" as const);
    const value = kind === "DOMAIN" ? raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") : raw;
    return { ...v, kind, value };
  })
  .refine((v) => (v.kind === "EMAIL" ? z.string().email().safeParse(v.value).success : DOMAIN_RE.test(v.value)), { message: "Enter an email address or a domain like acme.com" });
export const suppressionBulkInput = z.object({ values: z.array(z.string().trim().max(254)).min(1).max(500), reason: z.enum(SUPPRESSION_REASONS).default("do_not_contact") });

const norm = (email: string) => email.trim().toLowerCase();
const domainOfEmail = (email: string) => norm(email).split("@")[1] ?? "";

export interface SuppressionHit {
  kind: "EMAIL" | "DOMAIN" | "MARKETING";
  reason: string;
}

/** Why an address must not be contacted (null = allowed). Checks the CRM list (email + domain) and marketing unsubscribes. */
export async function suppressionFor(client: Tx | Db, companyId: string, email: string): Promise<SuppressionHit | null> {
  const e = norm(email);
  const d = domainOfEmail(e);
  const [crm, mkt] = await Promise.all([
    client.crmSuppression.findFirst({ where: { companyId, OR: [{ kind: "EMAIL", value: e }, ...(d ? [{ kind: "DOMAIN" as const, value: d }] : [])] }, select: { kind: true, reason: true } }),
    client.marketingSuppression.findFirst({ where: { companyId, emailNormalized: e }, select: { reason: true } }),
  ]);
  if (crm) return { kind: crm.kind, reason: crm.reason };
  if (mkt) return { kind: "MARKETING", reason: mkt.reason };
  return null;
}

/** Suppressed domains among `domains` (CRM list only — marketing unsubscribes are per address). */
export async function suppressedDomains(client: Tx | Db, companyId: string, domains: string[]): Promise<Set<string>> {
  if (!domains.length) return new Set();
  const rows = await client.crmSuppression.findMany({ where: { companyId, kind: "DOMAIN", value: { in: domains.map(norm) } }, select: { value: true } });
  return new Set(rows.map((r) => r.value));
}

/** Add an address/domain from the system (bounce, complaint, unsubscribe). Idempotent; keeps the first reason. */
export async function suppressSystem(tx: Tx, organizationId: string, companyId: string, kind: "EMAIL" | "DOMAIN", value: string, reason: SuppressionReason, source: string, note?: string) {
  await tx.crmSuppression.upsert({
    where: { companyId_kind_value: { companyId, kind, value: norm(value) } },
    create: { organizationId, companyId, kind, value: norm(value), reason, source, note: note?.slice(0, 300) ?? null },
    update: {},
  });
}

export async function listSuppressions(ctx: RequestContext, organizationId: string, companyId: string, opts: { q?: string; take?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const q = opts.q?.trim().toLowerCase();
  const where = { organizationId, companyId, ...(q ? { value: { contains: q } } : {}) };
  const [rows, total, marketing] = await Promise.all([
    db().crmSuppression.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(opts.take ?? 100, 500) }),
    db().crmSuppression.count({ where: { organizationId, companyId } }),
    db().marketingSuppression.count({ where: { organizationId, companyId } }),
  ]);
  return { rows, total, marketingUnsubscribes: marketing };
}

export async function addSuppression(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof suppressionInput>) {
  const input = suppressionInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const row = await tx.crmSuppression.upsert({
      where: { companyId_kind_value: { companyId, kind: input.kind, value: input.value } },
      create: { organizationId, companyId, kind: input.kind, value: input.value, reason: input.reason, source: "manual", note: input.note || null, createdById: actorId(ctx, organizationId) },
      update: { reason: input.reason, note: input.note || null },
    });
    const stopped = await stopOutreachTo(tx, companyId, input.kind, input.value);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.suppression.added", resourceType: "crm_suppression", resourceId: row.id, newValue: { kind: input.kind, reason: input.reason, stopped } });
    return { ...row, stopped };
  });
}

/** Paste a list of addresses / domains (invalid lines are skipped and counted). */
export async function addSuppressions(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof suppressionBulkInput>) {
  const input = suppressionBulkInput.parse(raw);
  const parsed = input.values.map((v) => suppressionInput.safeParse({ value: v, reason: input.reason })).flatMap((r) => (r.success ? [r.data] : []));
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const r = await tx.crmSuppression.createMany({
      data: parsed.map((p) => ({ organizationId, companyId, kind: p.kind, value: p.value, reason: p.reason, source: "manual", createdById: actorId(ctx, organizationId) })),
      skipDuplicates: true,
    });
    let stopped = 0;
    for (const p of parsed) stopped += await stopOutreachTo(tx, companyId, p.kind, p.value);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.suppression.imported", resourceType: "crm_suppression", resourceId: null, newValue: { added: r.count, invalid: input.values.length - parsed.length, stopped } });
    return { added: r.count, invalid: input.values.length - parsed.length, duplicates: parsed.length - r.count, stopped };
  });
}

export async function removeSuppression(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Entry");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const row = await tx.crmSuppression.findFirst({ where: { id, organizationId, companyId } });
    if (!row) throw notFound("Entry");
    await tx.crmSuppression.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.suppression.removed", resourceType: "crm_suppression", resourceId: id, oldValue: { kind: row.kind, reason: row.reason } });
    return { ok: true };
  });
}

/**
 * Stop everything still queued for a suppressed address/domain: unsent CRM emails are cancelled, sequence enrollments
 * stopped and prospecting people marked. Returns how many emails/enrollments were stopped.
 */
export async function stopOutreachTo(tx: Tx, companyId: string, kind: "EMAIL" | "DOMAIN", value: string): Promise<number> {
  const match = kind === "EMAIL" ? { equals: norm(value), mode: "insensitive" as const } : { endsWith: `@${norm(value)}`, mode: "insensitive" as const };
  const msgs = await tx.crmOutreachMessage.updateMany({ where: { companyId, toEmail: match, status: { in: ["DRAFT", "PENDING_APPROVAL", "FAILED"] } }, data: { status: "CANCELLED", error: "Do not contact" } });
  const enr = await tx.crmCadenceEnrollment.updateMany({ where: { companyId, toEmail: match, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "STOPPED", stoppedReason: "do_not_contact", nextRunAt: null } });
  await tx.crmProspectPerson.updateMany({
    where: { companyId, ...(kind === "EMAIL" ? { emailNormalized: norm(value) } : { domain: norm(value) }), status: { in: ["FOUND", "READY", "CONTACTED"] } },
    data: { status: "STOPPED", skipReason: "do_not_contact" },
  });
  return msgs.count + enr.count;
}
