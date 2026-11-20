import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { authorize, isUuid } from "./common";
import { zonedToUtc } from "./autopilot";

/**
 * Unified marketing calendar: content, social posts, autopilot slots and email campaigns on one timeline, with
 * drag-to-reschedule. Times are wall-clock in a chosen IANA time zone and converted on the server; anything that would
 * go out immediately (a scheduled item moved into the past) is refused, and items already handed to a provider are fixed.
 */

export const CALENDAR_KINDS = ["content", "post", "autopilot", "email"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export interface CalendarItem {
  key: string;
  kind: CalendarKind;
  id: string;
  title: string;
  status: string;
  /** Content type, platform or "email". */
  label: string;
  /** ISO instant. */
  at: string;
  href: string;
  movable: boolean;
  /** Why it cannot be moved (i18n key suffix), when not movable. */
  lock?: "published" | "provider" | "running" | "status";
}

const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const rescheduleInput = z.object({
  kind: z.enum(CALENDAR_KINDS),
  id: z.string().uuid(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z.string().min(1).max(64).refine(validTz, "Unknown time zone"),
});

const MOVABLE_CONTENT = new Set(["DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED"]);
const MOVABLE_ITEM = new Set(["IDEA", "RESEARCH", "DRAFT", "AI_REVIEW", "READY", "FAILED"]);

/** Everything on the marketing calendar between `from` and `to`. */
export async function calendarFeed(ctx: RequestContext, organizationId: string, companyId: string, from: Date, to: Date, base = ""): Promise<CalendarItem[]> {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const span = { gte: from, lt: to };
  const [content, posts, items, emails, cmsLocked] = await Promise.all([
    db().marketingContent.findMany({
      where: { organizationId, companyId, archivedAt: null, OR: [{ scheduledAt: span }, { publishedAt: span }] },
      select: { id: true, title: true, type: true, status: true, scheduledAt: true, publishedAt: true },
      take: 600,
    }),
    db().marketingSocialPost.findMany({
      where: { organizationId, companyId, status: { not: "CANCELLED" }, OR: [{ scheduledAt: span }, { publishedAt: span }] },
      select: { id: true, title: true, status: true, scheduledAt: true, publishedAt: true, targets: { select: { account: { select: { provider: true } } }, take: 4 } },
      take: 600,
    }),
    db().marketingAutopilotItem.findMany({
      where: { organizationId, companyId, slotAt: span, postId: null, stage: { notIn: ["REJECTED", "PUBLISHED", "ANALYZED", "SCHEDULED"] }, autopilot: { archivedAt: null } },
      select: { id: true, autopilotId: true, platform: true, format: true, stage: true, slotAt: true, topic: true, pendingTaskId: true },
      take: 600,
    }),
    db().marketingEmailCampaign.findMany({
      where: { organizationId, companyId, OR: [{ scheduledAt: span }, { startedAt: span }] },
      select: { id: true, name: true, status: true, scheduledAt: true, startedAt: true },
      take: 300,
    }),
    db().marketingCmsPublication.findMany({ where: { organizationId, companyId, status: "SCHEDULED", externalId: { not: null } }, select: { contentId: true }, take: 500 }),
  ]);
  const cms = new Set(cmsLocked.map((c) => c.contentId));
  const out: CalendarItem[] = [];
  for (const c of content) {
    const at = c.publishedAt ?? c.scheduledAt;
    if (!at) continue;
    const lock = c.publishedAt || c.status === "PUBLISHED" ? "published" : cms.has(c.id) ? "provider" : MOVABLE_CONTENT.has(c.status) ? undefined : "status";
    out.push({ key: `content:${c.id}`, kind: "content", id: c.id, title: c.title, status: c.status, label: c.type, at: at.toISOString(), href: `${base}/marketing/content/${c.id}`, movable: !lock, lock });
  }
  for (const p of posts) {
    const at = p.publishedAt ?? p.scheduledAt;
    if (!at) continue;
    const lock = p.status === "DRAFT" || p.status === "SCHEDULED" ? undefined : p.status === "PUBLISHING" ? "running" : p.status === "PUBLISHED" || p.status === "PARTIAL" ? "published" : "status";
    const label = [...new Set(p.targets.map((x) => x.account.provider))].join(" · ") || "SOCIAL";
    out.push({ key: `post:${p.id}`, kind: "post", id: p.id, title: p.title, status: p.status, label, at: at.toISOString(), href: `${base}/marketing/social/${p.id}`, movable: !lock, lock });
  }
  for (const i of items) {
    const lock = i.pendingTaskId ? "running" : MOVABLE_ITEM.has(i.stage) ? undefined : "status";
    out.push({ key: `autopilot:${i.id}`, kind: "autopilot", id: i.id, title: i.topic ?? `${i.platform} ${i.format}`, status: i.stage, label: `${i.platform} · ${i.format}`, at: i.slotAt.toISOString(), href: `${base}/marketing/autopilot/${i.autopilotId}`, movable: !lock, lock });
  }
  for (const e of emails) {
    const at = e.startedAt ?? e.scheduledAt;
    if (!at) continue;
    const lock = e.status === "DRAFT" || e.status === "SCHEDULED" ? undefined : e.status === "SENDING" ? "running" : "published";
    out.push({ key: `email:${e.id}`, kind: "email", id: e.id, title: e.name, status: e.status, label: "EMAIL", at: at.toISOString(), href: `${base}/marketing/email/${e.id}`, movable: !lock, lock });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Move a calendar item to a new local date/time. Returns the new instant. */
export async function rescheduleItem(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof rescheduleInput>) {
  const input = rescheduleInput.parse(raw);
  if (!isUuid(input.id)) throw notFound("Item");
  const at = zonedToUtc(input.day, input.time, input.timeZone);
  if (Number.isNaN(at.getTime())) throw invalid("Invalid date");
  const now = Date.now();
  const future = () => {
    // A scheduled item moved into the past would be sent at once — refuse instead of surprising anyone.
    if (at.getTime() < now + 60_000) throw invalid("Pick a time in the future", { reason: "marketing_calendar_past" });
  };
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    let old: Date | null = null;
    switch (input.kind) {
      case "content": {
        const c = await tx.marketingContent.findFirst({ where: { id: input.id, organizationId, companyId, archivedAt: null }, select: { status: true, scheduledAt: true, publishedAt: true } });
        if (!c) throw notFound("Content");
        if (c.publishedAt || !MOVABLE_CONTENT.has(c.status)) throw conflict("Published content cannot be moved", { reason: "marketing_calendar_locked" });
        const pubs = await tx.marketingCmsPublication.findMany({ where: { contentId: input.id, companyId, status: "SCHEDULED" }, select: { id: true, externalId: true } });
        if (pubs.some((p) => p.externalId)) throw conflict("This article is scheduled at the CMS — change it there or unschedule it first", { reason: "marketing_calendar_provider" });
        if (c.status === "SCHEDULED" || pubs.length) future();
        old = c.scheduledAt;
        await tx.marketingContent.update({ where: { id: input.id }, data: { scheduledAt: at } });
        if (pubs.length) await tx.marketingCmsPublication.updateMany({ where: { id: { in: pubs.map((p) => p.id) } }, data: { scheduledAt: at } });
        break;
      }
      case "post": {
        const p = await tx.marketingSocialPost.findFirst({ where: { id: input.id, organizationId, companyId }, select: { status: true, scheduledAt: true } });
        if (!p) throw notFound("Post");
        if (p.status !== "DRAFT" && p.status !== "SCHEDULED") throw conflict(`A ${p.status} post cannot be moved`, { reason: "marketing_calendar_locked" });
        if (p.status === "SCHEDULED") future();
        old = p.scheduledAt;
        // Guard against the queue picking it up concurrently.
        const { count } = await tx.marketingSocialPost.updateMany({ where: { id: input.id, status: p.status }, data: { scheduledAt: at } });
        if (!count) throw conflict("The post changed — reload", { reason: "marketing_calendar_locked" });
        break;
      }
      case "autopilot": {
        const i = await tx.marketingAutopilotItem.findFirst({ where: { id: input.id, organizationId, companyId, postId: null }, select: { stage: true, slotAt: true, pendingTaskId: true } });
        if (!i) throw notFound("Autopilot item");
        if (i.pendingTaskId || !MOVABLE_ITEM.has(i.stage)) throw conflict("This slot is being worked on and cannot be moved now", { reason: "marketing_calendar_locked" });
        future();
        old = i.slotAt;
        try {
          await tx.marketingAutopilotItem.update({ where: { id: input.id }, data: { slotAt: at } });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict("Another slot of this plan already uses that time", { reason: "marketing_calendar_slot_taken" });
          throw err;
        }
        break;
      }
      case "email": {
        const e = await tx.marketingEmailCampaign.findFirst({ where: { id: input.id, organizationId, companyId }, select: { status: true, scheduledAt: true } });
        if (!e) throw notFound("Email campaign");
        if (e.status !== "DRAFT" && e.status !== "SCHEDULED") throw conflict(`A ${e.status} email campaign cannot be moved`, { reason: "marketing_calendar_locked" });
        if (e.status === "SCHEDULED") future();
        old = e.scheduledAt;
        const { count } = await tx.marketingEmailCampaign.updateMany({ where: { id: input.id, status: e.status }, data: { scheduledAt: at } });
        if (!count) throw conflict("The campaign changed — reload", { reason: "marketing_calendar_locked" });
        break;
      }
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.calendar.rescheduled", resourceType: `marketing_${input.kind}`, resourceId: input.id, oldValue: { at: old }, newValue: { at, timeZone: input.timeZone } });
    return { at: at.toISOString() };
  });
}
