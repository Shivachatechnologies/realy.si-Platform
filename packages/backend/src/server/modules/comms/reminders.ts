import "server-only";
import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { notifyUsers } from "@/server/modules/notifications/service";
import { authorize, instant, isUuid, requireUserId } from "./common";

/**
 * Reminders: personal ones people set for themselves (optionally about a record) and automatic meeting reminders
 * 10 minutes before a meeting for every attendee who did not decline. Delivered as in-app notifications by the
 * worker (`deliverReminders`); `sentAt` records the delivery — nothing is shown as reminded before it happened.
 */

export const MEETING_LEAD_MS = 10 * 60_000;

export const reminderInput = z.object({
  title: z.string().trim().min(1).max(200),
  note: z.string().trim().max(2000).optional(),
  remindAt: instant,
  href: z.string().regex(/^\/[^\s]{0,300}$/).optional().or(z.literal("").transform(() => undefined)),
});

export async function createReminder(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof reminderInput>) {
  const input = reminderInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.read");
  const me = requireUserId(ctx);
  const at = new Date(input.remindAt);
  if (at.getTime() < Date.now() - 60_000) throw invalid("Pick a time in the future", { reason: "comms_reminder_past" });
  if (at.getTime() > Date.now() + 366 * 86_400_000) throw invalid("Pick a time within a year", { reason: "comms_reminder_far" });
  const open = await db().commsReminder.count({ where: { companyId, userId: me, sentAt: null } });
  if (open >= 200) throw invalid("Too many open reminders", { reason: "comms_reminder_limit" });
  return db().commsReminder.create({ data: { organizationId, companyId, userId: me, kind: "custom", title: input.title, note: input.note ?? null, remindAt: at, href: input.href ?? null, createdById: me } });
}

/** The viewer's upcoming reminders (and those delivered in the last day). */
export async function listMyReminders(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const me = requireUserId(ctx);
  return db().commsReminder.findMany({
    where: { organizationId, companyId, userId: me, OR: [{ sentAt: null }, { sentAt: { gte: new Date(Date.now() - 86_400_000) } }] },
    orderBy: { remindAt: "asc" },
    take: 50,
  });
}

export async function deleteReminder(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const me = requireUserId(ctx);
  if (!isUuid(id)) throw notFound("Reminder");
  const r = await db().commsReminder.deleteMany({ where: { id, organizationId, companyId, userId: me } });
  if (!r.count) throw notFound("Reminder");
  return { ok: true };
}

/** Worker: queue reminders for meetings starting soon (idempotent per attendee + meeting + start time). */
export async function queueMeetingReminders(now = new Date()): Promise<number> {
  const meetings = await db().commsMeeting.findMany({
    where: { status: "SCHEDULED", startsAt: { gt: now, lte: new Date(now.getTime() + MEETING_LEAD_MS + 5 * 60_000) } },
    select: { id: true, organizationId: true, companyId: true, title: true, startsAt: true, attendees: { where: { rsvp: { not: "DECLINED" } }, select: { userId: true } } },
    take: 500,
  });
  let n = 0;
  for (const m of meetings) {
    if (!m.attendees.length) continue;
    const r = await db().commsReminder.createMany({
      data: m.attendees.map((a) => ({
        organizationId: m.organizationId,
        companyId: m.companyId,
        userId: a.userId,
        kind: "meeting",
        title: m.title.slice(0, 200),
        remindAt: new Date(m.startsAt.getTime() - MEETING_LEAD_MS),
        href: `/communication/meetings/${m.id}`,
        subjectType: "meeting",
        subjectId: m.id,
      })),
      skipDuplicates: true,
    });
    n += r.count;
  }
  return n;
}

/** Worker: deliver due reminders as notifications and mark them sent. */
export async function deliverReminders(now = new Date()): Promise<number> {
  await queueMeetingReminders(now).catch((err) => logger.warn({ err: err instanceof Error ? err.message : err }, "meeting reminders queue failed"));
  const due = await db().commsReminder.findMany({ where: { sentAt: null, remindAt: { lte: now } }, orderBy: { remindAt: "asc" }, take: 200 });
  let n = 0;
  for (const r of due) {
    try {
      await transaction(async (tx) => {
        const claimed = await tx.commsReminder.updateMany({ where: { id: r.id, sentAt: null }, data: { sentAt: now } });
        if (!claimed.count) return;
        await notifyUsers(tx, r.organizationId, [r.userId], r.kind === "meeting" ? "comms.meeting_reminder" : "comms.reminder", { title: r.title, href: r.href ?? "/communication/calendar", companyId: r.companyId });
        n++;
      });
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err, reminderId: r.id }, "reminder delivery failed");
    }
  }
  return n;
}
