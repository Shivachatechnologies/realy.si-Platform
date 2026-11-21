import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { activeConnection } from "@/server/modules/comms/connections-bridge";
import { googleUpsertEvent, outlookUpsertEvent } from "@/server/modules/comms/providers";
import { actorId, authorize, isUuid } from "./common";
import { contactName } from "./contacts";

/**
 * Sales meetings with customers. When a Google or Outlook calendar is connected (Integrations), the meeting is added to
 * the organiser's calendar with the customer as a guest, and the calendar provider emails the invitation (Outlook does
 * so itself; Google is asked to with sendUpdates=all). Without a calendar the meeting is still saved and a calendar
 * file (.ics) is offered — the UI says plainly that nobody was invited.
 */

const ref = z.object({ leadId: z.string().uuid().optional(), contactId: z.string().uuid().optional(), dealId: z.string().uuid().optional() });
export const crmMeetingInput = ref
  .extend({
    title: z.string().trim().min(1).max(200),
    agenda: z.string().trim().max(5000).optional(),
    location: z.string().trim().max(300).optional(),
    startsAt: z.string().datetime({ offset: true }),
    durationMin: z.number().int().min(15).max(480).default(30),
    addToCalendar: z.boolean().default(true),
  })
  .refine((v) => [v.leadId, v.contactId, v.dealId].filter(Boolean).length === 1, { message: "Pick exactly one lead, contact or deal" });
export const crmMeetingPatch = z.object({ status: z.enum(["COMPLETED", "CANCELLED"]), outcome: z.string().trim().max(2000).optional() });

async function attendeeOf(organizationId: string, companyId: string, r: { leadId?: string; contactId?: string; dealId?: string }) {
  const base = { organizationId, companyId, archivedAt: null };
  if (r.leadId) {
    const l = await db().lead.findFirst({ where: { ...base, id: r.leadId }, select: { id: true, name: true, email: true } });
    if (!l) throw notFound("Lead");
    return { leadId: l.id, contactId: null, accountId: null, dealId: null, email: l.email, name: l.name };
  }
  if (r.contactId) {
    const c = await db().contact.findFirst({ where: { ...base, id: r.contactId }, select: { id: true, firstName: true, lastName: true, email: true, accountId: true } });
    if (!c) throw notFound("Contact");
    return { leadId: null, contactId: c.id, accountId: c.accountId, dealId: null, email: c.email, name: contactName(c) };
  }
  const d = await db().crmDeal.findFirst({ where: { ...base, id: r.dealId ?? "" }, select: { id: true, name: true, accountId: true, contact: { select: { id: true, firstName: true, lastName: true, email: true } } } });
  if (!d) throw notFound("Deal");
  return { leadId: null, contactId: d.contact?.id ?? null, accountId: d.accountId, dealId: d.id, email: d.contact?.email ?? null, name: d.contact ? contactName(d.contact) : d.name };
}

export async function scheduleMeeting(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof crmMeetingInput>) {
  const input = crmMeetingInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "sales.manage");
  const startsAt = new Date(input.startsAt);
  if (startsAt.getTime() < Date.now() - 60 * 60_000) throw invalid("Pick a time in the future", { reason: "crm_meeting_past" });
  const endsAt = new Date(startsAt.getTime() + input.durationMin * 60_000);
  const a = await attendeeOf(organizationId, companyId, input);
  const organizerId = actorId(ctx, organizationId);
  const meeting = await transaction(async (tx) => {
    const m = await tx.crmMeeting.create({
      data: {
        organizationId,
        companyId,
        title: input.title,
        agenda: input.agenda || null,
        location: input.location || null,
        startsAt,
        endsAt,
        leadId: a.leadId,
        contactId: a.contactId,
        accountId: a.accountId,
        dealId: a.dealId,
        attendeeEmail: a.email,
        attendeeName: a.name,
        organizerId,
      },
    });
    const summary = `Meeting booked: ${input.title}${input.location ? ` (${input.location})` : ""}`;
    if (a.leadId) await tx.leadActivity.create({ data: { organizationId, companyId, leadId: a.leadId, type: "MEETING", summary, occurredAt: startsAt, createdById: organizerId } });
    else await tx.crmActivity.create({ data: { organizationId, companyId, type: "MEETING", subject: input.title, summary, occurredAt: startsAt, durationMin: input.durationMin, contactId: a.contactId, accountId: a.accountId, dealId: a.dealId, createdById: organizerId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.meeting.scheduled", resourceType: "crm_meeting", resourceId: m.id, newValue: { title: m.title, startsAt, attendee: a.email } });
    return m;
  });
  if (!input.addToCalendar) return { ...meeting, calendar: "skipped" as const };
  return pushToCalendar(organizationId, companyId, meeting.id, organizerId);
}

/** Add the meeting to the connected calendar (customer as guest). Records the truth either way. */
async function pushToCalendar(organizationId: string, companyId: string, meetingId: string, organizerId: string) {
  const m = (await db().crmMeeting.findUnique({ where: { id: meetingId } }))!;
  let provider: "google_calendar" | "outlook_calendar" | null = null;
  let conn = null;
  for (const p of ["google_calendar", "outlook_calendar"] as const) {
    conn = await activeConnection(organizationId, companyId, p);
    if (conn) {
      provider = p;
      break;
    }
  }
  if (!provider || !conn) return { ...m, calendar: "not_connected" as const };
  const organizer = await db().user.findFirst({ where: { id: organizerId }, select: { email: true } });
  const event = { title: m.title, description: m.agenda, location: m.location, startsAt: m.startsAt, endsAt: m.endsAt, attendeeEmails: [m.attendeeEmail, organizer?.email].filter((x): x is string => !!x) };
  try {
    const externalId = provider === "google_calendar" ? await googleUpsertEvent(conn, event, m.externalId, { sendUpdates: "all" }) : await outlookUpsertEvent(conn, event, m.externalId);
    const u = await db().crmMeeting.update({ where: { id: m.id }, data: { calendarProvider: provider, externalId, inviteSentAt: m.attendeeEmail ? new Date() : null, calendarError: null } });
    return { ...u, calendar: "added" as const };
  } catch (err) {
    const u = await db().crmMeeting.update({ where: { id: m.id }, data: { calendarProvider: provider, calendarError: (err instanceof Error ? err.message : "calendar error").slice(0, 300) } });
    return { ...u, calendar: "failed" as const };
  }
}

export async function retryMeetingCalendar(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "sales.manage");
  if (!isUuid(id)) throw notFound("Meeting");
  const m = await db().crmMeeting.findFirst({ where: { id, organizationId, companyId, status: "SCHEDULED" } });
  if (!m) throw notFound("Meeting");
  return pushToCalendar(organizationId, companyId, id, m.organizerId);
}

export async function updateMeetingStatus(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof crmMeetingPatch>) {
  const input = crmMeetingPatch.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (!isUuid(id)) throw notFound("Meeting");
    const m = await tx.crmMeeting.findFirst({ where: { id, organizationId, companyId } });
    if (!m) throw notFound("Meeting");
    if (m.status !== "SCHEDULED") throw conflict("This meeting is already closed", { reason: "crm_meeting_closed" });
    const u = await tx.crmMeeting.update({ where: { id }, data: { status: input.status, outcome: input.outcome || null } });
    if (input.status === "COMPLETED" && input.outcome) {
      const summary = `Meeting notes — ${m.title}: ${input.outcome}`.slice(0, 5000);
      if (m.leadId) await tx.leadActivity.create({ data: { organizationId, companyId, leadId: m.leadId, type: "NOTE", summary, occurredAt: new Date(), createdById: actorId(ctx, organizationId) } });
      else await tx.crmActivity.create({ data: { organizationId, companyId, type: "NOTE", summary, occurredAt: new Date(), contactId: m.contactId, accountId: m.accountId, dealId: m.dealId, createdById: actorId(ctx, organizationId) } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `crm.meeting.${input.status.toLowerCase()}`, resourceType: "crm_meeting", resourceId: id });
    if (input.status === "COMPLETED") {
      await emitDomainEvent(tx, ctx, "meeting.completed", { organizationId, companyId, entityType: "crm_meeting", entityId: id, data: { title: m.title, leadId: m.leadId, contactId: m.contactId, dealId: m.dealId, source: "crm" } });
    }
    return u;
  });
}

export async function listCrmMeetings(ctx: RequestContext, organizationId: string, companyId: string, f: { leadId?: string; contactId?: string; dealId?: string; upcoming?: boolean; take?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  return db().crmMeeting.findMany({
    where: {
      organizationId,
      companyId,
      ...(f.leadId ? { leadId: f.leadId } : {}),
      ...(f.contactId ? { contactId: f.contactId } : {}),
      ...(f.dealId ? { dealId: f.dealId } : {}),
      ...(f.upcoming ? { status: "SCHEDULED" as const, endsAt: { gte: new Date(Date.now() - 2 * 3_600_000) } } : {}),
    },
    orderBy: { startsAt: f.upcoming ? "asc" : "desc" },
    take: Math.min(f.take ?? 50, 200),
  });
}

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** Fold lines longer than 75 octets (RFC 5545). */
const fold = (line: string) => (line.length <= 74 ? line : line.match(/.{1,74}/g)!.join("\r\n "));

/** An iCalendar (.ics) file for the meeting: import into any calendar, or send to the customer yourself. */
export async function meetingIcs(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  if (!isUuid(id)) throw notFound("Meeting");
  const m = await db().crmMeeting.findFirst({ where: { id, organizationId, companyId } });
  if (!m) throw notFound("Meeting");
  const organizer = await db().user.findFirst({ where: { id: m.organizerId }, select: { name: true, email: true } });
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Realy//CRM//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${m.id}@realy.si`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(m.startsAt)}`,
    `DTEND:${icsDate(m.endsAt)}`,
    `SUMMARY:${icsText(m.title)}`,
    ...(m.agenda ? [`DESCRIPTION:${icsText(m.agenda)}`] : []),
    ...(m.location ? [`LOCATION:${icsText(m.location)}`] : []),
    ...(organizer?.email ? [`ORGANIZER;CN=${icsText(organizer.name)}:mailto:${organizer.email}`] : []),
    ...(m.attendeeEmail ? [`ATTENDEE;CN=${icsText(m.attendeeName ?? m.attendeeEmail)};ROLE=REQ-PARTICIPANT:mailto:${m.attendeeEmail}`] : []),
    `STATUS:${m.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return { filename: `${m.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "meeting"}.ics`, body: lines.map(fold).join("\r\n") + "\r\n" };
}

/** Replace a scheduled meeting's agenda (meeting intelligence: generated or edited agenda, saved by a person). */
export async function setCrmMeetingAgenda(ctx: RequestContext, organizationId: string, companyId: string, id: string, agenda: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (!isUuid(id)) throw notFound("Meeting");
    const m = await tx.crmMeeting.findFirst({ where: { id, organizationId, companyId } });
    if (!m) throw notFound("Meeting");
    if (m.status !== "SCHEDULED") throw conflict("This meeting is already closed", { reason: "crm_meeting_closed" });
    const u = await tx.crmMeeting.update({ where: { id }, data: { agenda: agenda.slice(0, 5000) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.meeting.agenda_updated", resourceType: "crm_meeting", resourceId: id });
    return u;
  });
}
