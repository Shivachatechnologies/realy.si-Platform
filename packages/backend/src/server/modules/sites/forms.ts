import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { AppError, invalid, isAppError, notFound } from "@/server/core/errors";
import { consume } from "@/server/core/rate-limit";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { addActivity, createLead } from "@/server/modules/crm/service";
import { authorize, isUuid, uuid } from "./common";
import { readContent, siteSlugSchema, type SiteBlockOf } from "./schemas";

/**
 * Contact / lead forms on published pages. A submission needs the visitor's explicit consent (the exact text shown is
 * stored), creates a CRM lead through the CRM service (or adds a note to the existing lead with the same email), lands
 * in the website inbox and emits `site.form_submitted`. Spam protection: a honeypot field and a minimum fill time
 * (bots get a normal-looking success and nothing is stored), per-IP rate limits on the route and a per-site limit here.
 */

const HOUR = 3_600_000;
const SITE_LIMIT = { name: "site-form:site", limit: 60, windowMs: HOUR };

export const publicSubmissionInput = z.object({
  pageId: uuid,
  blockId: z.string().regex(/^[a-z0-9]{4,24}$/),
  values: z.object({
    name: z.string().trim().max(200).optional(),
    email: z.string().trim().max(254).optional(),
    phone: z.string().trim().max(40).optional(),
    company: z.string().trim().max(200).optional(),
    message: z.string().trim().max(5000).optional(),
  }),
  consent: z.boolean(),
  /** Honeypot: hidden from people, filled by bots. */
  website: z.string().max(500).optional(),
  /** Milliseconds the form was open before sending (bots send instantly). */
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
  utmSource: z.string().trim().max(100).optional(),
  utmMedium: z.string().trim().max(100).optional(),
  utmCampaign: z.string().trim().max(100).optional(),
});

async function liveFormBlock(siteId: string, pageId: string, blockId: string) {
  const page = await db().sitePage.findFirst({ where: { id: pageId, siteId, status: { in: ["PUBLISHED", "SCHEDULED"] } }, select: { id: true, slug: true, status: true, published: true, pending: true, publishAt: true } });
  if (!page) return null;
  const raw = page.status === "SCHEDULED" && page.pending && page.publishAt && page.publishAt <= new Date() ? page.pending : page.published;
  if (!raw) return null;
  const block = readContent(raw).blocks.find((b): b is SiteBlockOf<"contactForm"> => b.id === blockId && b.type === "contactForm");
  return block ? { page, block } : null;
}

export async function submitSiteForm(siteSlugRaw: string, raw: z.input<typeof publicSubmissionInput>) {
  const input = publicSubmissionInput.parse(raw);
  const slug = siteSlugSchema.safeParse(siteSlugRaw);
  if (!slug.success) throw notFound("Website");
  const site = await db().site.findFirst({ where: { slug: slug.data, online: true, company: { deletedAt: null, status: "ACTIVE" } }, select: { id: true, organizationId: true, companyId: true, name: true } });
  if (!site) throw notFound("Website");
  const found = await liveFormBlock(site.id, input.pageId, input.blockId);
  if (!found) throw notFound("Form");
  const { page, block } = found;
  const success = { ok: true, message: block.successMessage || null };
  // Bots: honeypot filled or sent faster than a person can type → a normal-looking success, nothing stored.
  if (input.website || (input.elapsedMs !== undefined && input.elapsedMs < 2500)) return success;

  const limit = await consume(SITE_LIMIT, site.id);
  if (!limit.allowed) throw new AppError("rate_limited", "Too many requests");

  const issues: { path: string; message: string }[] = [];
  const v = input.values;
  const value = (k: "name" | "email" | "phone" | "company" | "message") => (v[k] ?? "").trim();
  for (const f of block.fields) if (f.required && !value(f.key)) issues.push({ path: f.key, message: "required" });
  const email = value("email");
  if (email && !z.string().email().max(254).safeParse(email).success) issues.push({ path: "email", message: "invalid_email" });
  if (!input.consent) issues.push({ path: "consent", message: "required" });
  if (issues.length) throw invalid("Invalid submission", { issues });

  const asked = new Set(block.fields.map((f) => f.key));
  const keep = (k: "name" | "phone" | "company" | "message") => (asked.has(k) && value(k) ? value(k) : null);
  const name = keep("name") || email.split("@")[0] || "Website visitor";
  const message = keep("message");
  const consentText = (block.consentText || "I agree that my details are stored to answer my request.").slice(0, 600);
  const source = `Website: ${site.name}`.slice(0, 100);
  const ctx = systemContext();

  // CRM lead through the CRM service (scoring, assignment rules, lead.created). A known email adds a note instead.
  let leadId: string | null = null;
  try {
    const lead = await createLead(ctx, site.organizationId, site.companyId, {
      name: name.slice(0, 200),
      email,
      phone: keep("phone") ?? undefined,
      account: keep("company") ?? undefined,
      source,
      campaignCode: input.utmCampaign || undefined,
      notes: [message, `Page: /${page.slug}`, `Consent: ${consentText}`].filter(Boolean).join("\n\n").slice(0, 5000),
    });
    leadId = lead.id;
  } catch (err) {
    const ids = isAppError(err) && err.details?.reason === "lead_duplicate" ? (err.details.leadIds as string[] | undefined) : undefined;
    if (ids?.[0]) {
      leadId = ids[0];
      await addActivity(ctx, site.organizationId, site.companyId, leadId, { type: "NOTE", summary: `Website form on /${page.slug}${message ? `\n${message}` : ""}`.slice(0, 5000) }).catch(() => undefined);
    } else {
      // The visitor's message is never lost: it is stored in the inbox without a lead and the team is notified.
      logger.warn({ err: err instanceof Error ? err.message : String(err), siteId: site.id }, "site form: lead not created");
    }
  }

  await transaction(async (tx) => {
    const submission = await tx.siteFormSubmission.create({
      data: {
        organizationId: site.organizationId,
        companyId: site.companyId,
        siteId: site.id,
        pageId: page.id,
        blockId: block.id,
        pagePath: page.slug,
        name: keep("name"),
        email: email || null,
        phone: keep("phone"),
        account: keep("company"),
        message,
        consentText,
        consentAt: new Date(),
        leadId,
        utmSource: input.utmSource || null,
        utmMedium: input.utmMedium || null,
        utmCampaign: input.utmCampaign || null,
      },
    });
    await emitDomainEvent(tx, ctx, "site.form_submitted", { organizationId: site.organizationId, companyId: site.companyId, entityType: "site_form_submission", entityId: submission.id, data: { siteId: site.id, submissionId: submission.id, pageId: page.id, pagePath: page.slug, leadId, email: email || null, name, consent: true, campaignCode: input.utmCampaign || null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: site.organizationId, action: "site.form.submitted", resourceType: "site_form_submission", resourceId: submission.id, newValue: { siteId: site.id, pagePath: page.slug, leadId } });
    const recipients = await usersWithPermission(tx, site.organizationId, site.companyId, "marketing.manage");
    await notifyUsers(tx, site.organizationId, recipients, "sites.form_submission", { companyId: site.companyId, title: name, href: "/website/submissions" });
  });
  return success;
}

// ───────────── Inbox ─────────────

const STATUSES = ["NEW", "READ", "ARCHIVED"] as const;
export const submissionFilters = z.object({ status: z.enum(STATUSES).optional().catch(undefined), page: z.coerce.number().int().min(1).max(1000).default(1).catch(1) });
const PAGE_SIZE = 25;

export async function listSubmissions(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, unknown> = {}) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const f = submissionFilters.parse(raw);
  const where = { organizationId, companyId, ...(f.status ? { status: f.status } : { status: { not: "ARCHIVED" as const } }) };
  const [rows, total, counts] = await Promise.all([
    db().siteFormSubmission.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db().siteFormSubmission.count({ where }),
    db().siteFormSubmission.groupBy({ by: ["status"], where: { organizationId, companyId }, _count: { _all: true } }),
  ]);
  return { data: rows, total, page: f.page, pageSize: PAGE_SIZE, status: f.status ?? null, counts: Object.fromEntries(STATUSES.map((s) => [s, counts.find((c) => c.status === s)?._count._all ?? 0])) as Record<(typeof STATUSES)[number], number> };
}

export const updateSubmissionInput = z.object({ status: z.enum(STATUSES) });

export async function updateSubmission(ctx: RequestContext, organizationId: string, companyId: string, submissionId: string, raw: z.input<typeof updateSubmissionInput>) {
  const input = updateSubmissionInput.parse(raw);
  if (!isUuid(submissionId)) throw notFound("Submission");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const row = await tx.siteFormSubmission.findFirst({ where: { id: submissionId, organizationId, companyId }, select: { id: true, status: true } });
    if (!row) throw notFound("Submission");
    await tx.siteFormSubmission.update({ where: { id: row.id }, data: { status: input.status } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "site.form.status_changed", resourceType: "site_form_submission", resourceId: row.id, oldValue: { status: row.status }, newValue: { status: input.status } });
    return { id: row.id, status: input.status };
  });
}

