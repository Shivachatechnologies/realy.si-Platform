import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { activeConnection } from "./connections-bridge";
import { googleListEvents, googleUpsertEvent, outlookListEvents, outlookUpsertEvent, type CalendarEventData, type OutgoingEvent } from "./providers";

/**
 * Two-way meeting sync with Google Calendar / Outlook calendar (when connected through Integrations).
 * Pull: provider events in [-7d, +60d] become / update meetings (matched by external id). Push: local scheduled
 * meetings without an external id are created at the provider; edited ones are patched.
 */

type CalendarProvider = "google_calendar" | "outlook_calendar";
const CALENDARS: CalendarProvider[] = ["google_calendar", "outlook_calendar"];

async function calendarConnection(organizationId: string, companyId: string) {
  for (const p of CALENDARS) {
    const c = await activeConnection(organizationId, companyId, p);
    if (c) return { provider: p, conn: c };
  }
  return null;
}

async function outgoing(meetingId: string): Promise<OutgoingEvent | null> {
  const m = await db().commsMeeting.findUnique({ where: { id: meetingId }, include: { attendees: { select: { userId: true } } } });
  if (!m) return null;
  const users = await db().user.findMany({ where: { id: { in: m.attendees.map((a) => a.userId) } }, select: { email: true } });
  return { title: m.title, description: m.agenda, location: m.location, startsAt: m.startsAt, endsAt: m.endsAt, attendeeEmails: users.map((u) => u.email) };
}

/** Create or update the provider event of one meeting. No-op when no calendar is connected. */
export async function pushMeetingToCalendar(organizationId: string, companyId: string, meetingId: string) {
  const c = await calendarConnection(organizationId, companyId);
  if (!c) return false;
  const m = await db().commsMeeting.findFirst({ where: { id: meetingId, organizationId, companyId }, select: { externalProvider: true, externalId: true, status: true } });
  if (!m || m.status !== "SCHEDULED") return false;
  if (m.externalProvider && m.externalProvider !== c.provider) return false;
  const e = await outgoing(meetingId);
  if (!e) return false;
  const externalId = c.provider === "google_calendar" ? await googleUpsertEvent(c.conn, e, m.externalId) : await outlookUpsertEvent(c.conn, e, m.externalId);
  await db().commsMeeting.update({ where: { id: meetingId }, data: { externalProvider: c.provider, externalId } });
  return true;
}

async function pullEvents(organizationId: string, companyId: string, provider: CalendarProvider, events: CalendarEventData[], fallbackOrganizer: string) {
  const emails = [...new Set(events.flatMap((e) => e.attendeeEmails.map((a) => a.toLowerCase())))];
  const users = emails.length
    ? await db().user.findMany({ where: { email: { in: emails, mode: "insensitive" }, memberships: { some: { organizationId, status: "ACTIVE" } } }, select: { id: true, email: true } })
    : [];
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  let n = 0;
  for (const e of events) {
    const attendeeIds = [...new Set(e.attendeeEmails.map((a) => byEmail.get(a.toLowerCase())).filter((x): x is string => !!x))];
    const existing = await db().commsMeeting.findFirst({ where: { companyId, externalProvider: provider, externalId: e.externalId }, select: { id: true, status: true } });
    if (existing) {
      if (existing.status === "COMPLETED") continue;
      await db().commsMeeting.update({
        where: { id: existing.id },
        data: { title: e.title.slice(0, 200), location: e.location, startsAt: e.startsAt, endsAt: e.endsAt, status: e.cancelled ? "CANCELLED" : "SCHEDULED" },
      });
      n++;
      continue;
    }
    if (e.cancelled || !attendeeIds.length) continue; // only events involving people of this organization
    await db().commsMeeting.create({
      data: {
        organizationId,
        companyId,
        title: e.title.slice(0, 200),
        agenda: e.description?.slice(0, 10_000) ?? null,
        location: e.location,
        startsAt: e.startsAt,
        endsAt: e.endsAt > e.startsAt ? e.endsAt : new Date(e.startsAt.getTime() + 30 * 60_000),
        organizerId: attendeeIds[0] ?? fallbackOrganizer,
        externalProvider: provider,
        externalId: e.externalId,
        attendees: { create: attendeeIds.map((userId) => ({ userId, companyId })) },
      },
    });
    n++;
  }
  return n;
}

/** Sync one company's meetings with its connected calendar; returns the number of meetings changed. */
export async function syncCompanyCalendar(organizationId: string, companyId: string) {
  const c = await calendarConnection(organizationId, companyId);
  if (!c) return 0;
  const from = new Date(Date.now() - 7 * 86_400_000);
  const to = new Date(Date.now() + 60 * 86_400_000);
  const company = await db().company.findFirstOrThrow({ where: { id: companyId }, select: { createdById: true } });
  const events = c.provider === "google_calendar" ? await googleListEvents(c.conn, from, to) : await outlookListEvents(c.conn, from, to);
  let n = await pullEvents(organizationId, companyId, c.provider, events, company.createdById);
  const unsynced = await db().commsMeeting.findMany({ where: { organizationId, companyId, status: "SCHEDULED", externalId: null, startsAt: { gte: new Date() } }, select: { id: true }, take: 50 });
  for (const m of unsynced) if (await pushMeetingToCalendar(organizationId, companyId, m.id)) n++;
  return n;
}

/** Worker: sync every active company (companies without a calendar connection are skipped cheaply). */
export async function syncAllCalendars(): Promise<number> {
  const companies = await db().company.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true, organizationId: true }, take: 1000 });
  let n = 0;
  for (const c of companies) {
    try {
      n += await syncCompanyCalendar(c.organizationId, c.id);
    } catch (err) {
      logger.warn({ err, companyId: c.id }, "calendar sync failed");
    }
  }
  return n;
}
