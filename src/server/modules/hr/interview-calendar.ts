import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { activeConnection } from "@/server/modules/comms/connections-bridge";
import { googleUpsertEvent, outlookUpsertEvent, type OutgoingEvent } from "@/server/modules/comms/providers";
import { authorize, employeeName, isUuid } from "./access";

/**
 * Interview scheduling with the company's calendar (Google Calendar / Outlook through Integrations). When a calendar is
 * connected the interview is created (or moved) at the provider with the candidate and interviewers as attendees and
 * the provider's event id is stored; when none is connected nothing is claimed as synced and HR gets an .ics file to
 * add it by hand.
 */

type CalendarProvider = "google_calendar" | "outlook_calendar";

export async function interviewCalendar(organizationId: string, companyId: string) {
  for (const p of ["google_calendar", "outlook_calendar"] as const) {
    const conn = await activeConnection(organizationId, companyId, p).catch(() => null);
    if (conn) return { provider: p as CalendarProvider, conn };
  }
  return null;
}

/** Which calendar (if any) interviews will go to — for the scheduling UI. */
export async function interviewCalendarStatus(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  const c = await interviewCalendar(organizationId, companyId);
  return { provider: c?.provider ?? null };
}

async function outgoing(interviewId: string): Promise<(OutgoingEvent & { calendarProvider: string | null; calendarEventId: string | null; status: string; organizationId: string; companyId: string }) | null> {
  const iv = await db().hrInterview.findUnique({
    where: { id: interviewId },
    include: { candidate: { select: { firstName: true, lastName: true, email: true, job: { select: { title: true } } } } },
  });
  if (!iv) return null;
  const interviewers = iv.interviewerIds.length ? await db().employee.findMany({ where: { id: { in: iv.interviewerIds }, companyId: iv.companyId }, select: { email: true } }) : [];
  const name = employeeName(iv.candidate);
  const title = `Interview: ${name}${iv.candidate.job ? ` — ${iv.candidate.job.title}` : ""}`.slice(0, 200);
  return {
    organizationId: iv.organizationId,
    companyId: iv.companyId,
    status: iv.status,
    calendarProvider: iv.calendarProvider,
    calendarEventId: iv.calendarEventId,
    title,
    description: [`${iv.type} interview`, iv.notes].filter(Boolean).join("\n\n"),
    location: iv.location,
    startsAt: iv.scheduledAt,
    endsAt: new Date(iv.scheduledAt.getTime() + iv.durationMin * 60_000),
    attendeeEmails: [...new Set([iv.candidate.email, ...interviewers.map((e) => e.email).filter((e): e is string => !!e)])],
  };
}

/**
 * Create or update the provider event of one interview. Returns the outcome; never throws (the interview itself is
 * already saved). Cancelled interviews are not pushed.
 */
export async function pushInterviewToCalendar(organizationId: string, companyId: string, interviewId: string): Promise<{ synced: boolean; provider: CalendarProvider | null; error?: string }> {
  const c = await interviewCalendar(organizationId, companyId);
  if (!c) return { synced: false, provider: null };
  const e = await outgoing(interviewId);
  if (!e || e.organizationId !== organizationId || e.companyId !== companyId || e.status !== "SCHEDULED") return { synced: false, provider: c.provider };
  // An event created in another provider stays there; we only patch events of the connected provider.
  const existing = e.calendarProvider === c.provider ? e.calendarEventId : null;
  try {
    const eventId = c.provider === "google_calendar" ? await googleUpsertEvent(c.conn, e, existing) : await outlookUpsertEvent(c.conn, e, existing);
    await db().hrInterview.update({ where: { id: interviewId }, data: { calendarProvider: c.provider, calendarEventId: eventId, calendarSyncedAt: new Date(), calendarError: null } });
    return { synced: true, provider: c.provider };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : "Calendar error";
    logger.warn({ err, interviewId }, "interview calendar push failed");
    await db().hrInterview.update({ where: { id: interviewId }, data: { calendarError: message } });
    return { synced: false, provider: c.provider, error: message };
  }
}

/** Manual retry from the interview page. */
export async function syncInterviewCalendar(ctx: RequestContext, organizationId: string, companyId: string, interviewId: string) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  if (!isUuid(interviewId) || !(await db().hrInterview.findFirst({ where: { id: interviewId, organizationId, companyId }, select: { id: true } }))) throw notFound("Interview");
  return pushInterviewToCalendar(organizationId, companyId, interviewId);
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);

/** iCalendar (.ics) file of one interview, for adding it to any calendar by hand. */
export async function interviewIcs(ctx: RequestContext, organizationId: string, companyId: string, interviewId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  if (!isUuid(interviewId) || !(await db().hrInterview.findFirst({ where: { id: interviewId, organizationId, companyId }, select: { id: true } }))) throw notFound("Interview");
  const e = (await outgoing(interviewId))!;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Realy.si//HR Interviews//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${interviewId}@realy.si`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(e.startsAt)}`,
    `DTEND:${icsDate(e.endsAt)}`,
    `SUMMARY:${icsText(e.title)}`,
    ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    ...e.attendeeEmails.map((a) => `ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:${a}`),
    `STATUS:${e.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}
