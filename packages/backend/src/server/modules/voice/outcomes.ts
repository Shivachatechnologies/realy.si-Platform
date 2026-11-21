import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/core/db";
import { systemContext, userContext } from "@/server/core/context";
import { isAppError } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { addActivity, addFollowUp, createLead } from "@/server/modules/crm/service";
import { addCrmActivity, addCrmFollowUp } from "@/server/modules/crm/activities";
import { scheduleMeeting } from "@/server/modules/crm/meetings";
import { createTicket } from "@/server/modules/support/tickets";
import { maskNumber, obj, str, type CallResult, type TranscriptLine } from "./common";
import { emitVoiceEvent, ensureSettings } from "./service";
import { scheduleCampaignFollowUpCall } from "./live";
import { syncRunTargetForCall } from "./runs";

/**
 * After a call: log it on the CRM record, create follow-ups, book the meeting the person agreed to, open a support
 * ticket or a lead for inbound callers, take a message for the founder, honour "do not call me again", and tell the
 * person who requested the call. Everything is created through the owning modules' services (real records), and each
 * created record is listed on the call. Runs once per call (claimed via processedAt).
 */

const DAY = 86_400_000;

function futureDate(v: unknown, minLeadMs = 15 * 60_000): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T09:00:00Z` : s);
  if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() + minLeadMs || d.getTime() > Date.now() + 365 * DAY) return null;
  return d;
}

const duration = (sec: number | null) => (sec ? `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s` : "no answer");
const outcomeLabel = (o: string | null) => (o ? o.toLowerCase().replace(/_/g, " ") : "unknown");

function excerpt(transcript: unknown, max = 3000): string {
  const lines = (Array.isArray(transcript) ? (transcript as TranscriptLine[]) : []).map((l) => `${l.role === "agent" ? "AI" : "Caller"}: ${l.text}`);
  return lines.join("\n").slice(0, max);
}

export async function processCall(callId: string): Promise<number> {
  // Claim: one processor per call.
  const claimed = await db().voiceCall.updateMany({ where: { id: callId, processedAt: null, externalCallId: { not: null }, status: { in: ["ENDED", "FAILED"] } }, data: { processedAt: new Date() } });
  if (!claimed.count) return 0;
  try {
    return await run(callId);
  } catch (err) {
    await db().voiceCall.update({ where: { id: callId }, data: { processedAt: null } });
    throw err;
  }
}

async function run(callId: string): Promise<number> {
  const call = await db().voiceCall.findUniqueOrThrow({ where: { id: callId }, include: { agent: { select: { name: true, goal: true } } } });
  const { organizationId, companyId } = call;
  const settings = await ensureSettings(db(), organizationId, companyId);
  const company = await db().company.findFirst({ where: { id: companyId }, select: { createdById: true, name: true } });
  const sys = systemContext();
  const a = obj(call.analysis);
  const results: CallResult[] = [];
  const href = `/voice/calls/${call.id}`;
  const connected = call.status === "ENDED" && (call.durationSec ?? 0) > 0 && call.outcome !== "NO_ANSWER" && call.outcome !== "VOICEMAIL";
  const who = call.subjectName ?? (call.direction === "INBOUND" ? (call.fromNumber ? maskNumber(call.fromNumber) : "Unknown caller") : maskNumber(call.toNumber));
  const caller = call.direction === "INBOUND" ? call.fromNumber : call.toNumber;
  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      logger.info({ callId, step: label, err: isAppError(err) ? err.message : err instanceof Error ? err.message : err }, "voice post-call step skipped");
      return null;
    }
  };

  let leadId = call.leadId;
  const contactId = call.contactId;

  // Inbound routing for unknown callers: sales interest → CRM lead (lead-worthy outcomes only).
  if (call.direction === "INBOUND" && !leadId && !contactId && connected && settings.inboundLeads && ["INTERESTED", "MEETING_REQUESTED", "CALLBACK_REQUESTED"].includes(call.outcome ?? "")) {
    const email = str(a.caller_email);
    const lead = await safe("lead", () =>
      createLead(sys, organizationId, companyId, {
        name: (str(a.caller_name) ?? `Caller ${caller ? maskNumber(caller) : ""}`).slice(0, 200),
        email: email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : undefined,
        phone: caller ?? undefined,
        account: str(a.caller_company)?.slice(0, 200),
        source: "Phone (AI receptionist)",
        notes: (call.summary ?? "").slice(0, 5000) || undefined,
        tags: ["phone"],
      }),
    );
    if (lead) {
      leadId = lead.id;
      await db().voiceCall.update({ where: { id: call.id }, data: { leadId: lead.id, subjectName: call.subjectName ?? lead.name } });
      results.push({ type: "lead", id: lead.id, label: lead.name, href: `/crm/${lead.id}` });
    }
  }

  // CRM timeline entry.
  const summaryText = [`AI phone call (${call.direction === "INBOUND" ? "inbound" : "outbound"}${call.agent ? `, ${call.agent.name}` : ""}, ${duration(call.durationSec)}) — outcome: ${outcomeLabel(call.outcome)}.`, call.summary ? `Summary: ${call.summary}` : "", `Transcript in Realy: ${href}`]
    .filter(Boolean)
    .join("\n")
    .slice(0, 5000);
  if (leadId) {
    const act = await safe("lead_activity", () => addActivity(sys, organizationId, companyId, leadId!, { type: "CALL", summary: summaryText, occurredAt: (call.startedAt ?? call.createdAt).toISOString() }));
    if (act) results.push({ type: "lead_activity", id: act.id, label: "Call logged on the lead", href: `/crm/${leadId}` });
  } else if (contactId) {
    const act = await safe("crm_activity", () =>
      addCrmActivity(sys, organizationId, companyId, { subjectType: "contact", subjectId: contactId, type: "CALL", subject: "AI phone call", summary: summaryText, occurredAt: (call.startedAt ?? call.createdAt).toISOString(), durationMin: call.durationSec ? Math.ceil(call.durationSec / 60) : undefined }),
    );
    if (act) results.push({ type: "crm_activity", id: act.id, label: "Call logged on the contact", href: `/crm/contacts/${contactId}` });
  }

  // Meeting the person agreed to (exact time) → booked through the CRM meetings service, organised by a person.
  let meetingBooked = false;
  const meetingAt = connected && a.meeting_requested === true ? futureDate(a.meeting_time, 60 * 60_000) : null;
  const organizerId = call.requestedById && call.requestedById !== organizationId ? call.requestedById : (settings.voicemailUserId ?? company?.createdById ?? null);
  if (meetingAt && settings.autoFollowUps && organizerId && (leadId || contactId)) {
    const m = await safe("meeting", () =>
      scheduleMeeting(userContext(organizerId), organizationId, companyId, {
        ...(leadId ? { leadId } : { contactId: contactId! }),
        title: `Meeting with ${who}`.slice(0, 200),
        agenda: `Agreed on an AI phone call.\n\n${call.summary ?? ""}`.slice(0, 5000),
        startsAt: meetingAt.toISOString(),
        durationMin: 30,
        addToCalendar: true,
      }),
    );
    if (m) {
      meetingBooked = true;
      results.push({ type: "crm_meeting", id: m.id, label: `Meeting ${meetingAt.toISOString().slice(0, 16).replace("T", " ")} UTC (${m.calendar === "added" ? "calendar invite sent" : m.calendar === "not_connected" ? "no calendar connected" : m.calendar})`, href: leadId ? `/crm/${leadId}` : `/crm/contacts/${contactId}` });
      await db().voiceCall.update({ where: { id: call.id }, data: { outcome: "MEETING_BOOKED" } });
    }
  }

  // Follow-ups for the team.
  if (settings.autoFollowUps && (leadId || contactId)) {
    const tasks: { dueAt: Date; note: string; priority: "LOW" | "MEDIUM" | "HIGH" }[] = [];
    if (a.meeting_requested === true && !meetingBooked) tasks.push({ dueAt: new Date(Date.now() + DAY), note: `Book the meeting ${who} agreed to on the AI call${str(a.meeting_time) ? ` (asked for ${str(a.meeting_time)})` : ""}.`, priority: "HIGH" });
    if (a.callback_requested === true) tasks.push({ dueAt: futureDate(a.callback_time) ?? new Date(Date.now() + DAY), note: `Call ${who} back as they asked on the AI call.`, priority: "MEDIUM" });
    if (call.outcome === "PAYMENT_PROMISED") tasks.push({ dueAt: futureDate(a.payment_promise_date, 0) ?? new Date(Date.now() + 3 * DAY), note: `Check the payment ${who} promised on the AI call.`, priority: "MEDIUM" });
    const note = str(a.follow_up_note);
    if (note && !tasks.length) tasks.push({ dueAt: new Date(Date.now() + DAY), note: note.slice(0, 900), priority: "MEDIUM" });
    for (const t of tasks.slice(0, 3)) {
      const f = leadId
        ? await safe("lead_follow_up", () => addFollowUp(sys, organizationId, companyId, leadId!, { dueAt: t.dueAt.toISOString(), note: t.note, priority: t.priority }))
        : await safe("crm_follow_up", () => addCrmFollowUp(sys, organizationId, companyId, { subjectType: "contact", subjectId: contactId!, dueAt: t.dueAt.toISOString(), note: t.note, priority: t.priority }));
      if (f) results.push({ type: leadId ? "lead_follow_up" : "crm_follow_up", id: f.id, label: t.note.slice(0, 120), href: leadId ? `/crm/${leadId}` : `/crm/contacts/${contactId}` });
    }
  }

  // Support issue → ticket (inbound, or the support-triage goal).
  const issue = str(a.support_issue);
  if (connected && settings.inboundTickets && issue && (call.outcome === "SUPPORT_ISSUE" || call.agent?.goal === "SUPPORT_TRIAGE")) {
    const email = str(a.caller_email);
    const t = await safe("ticket", () =>
      createTicket(sys, organizationId, companyId, {
        subject: `Phone: ${issue}`.slice(0, 300),
        description: [`Reported on an AI phone call from ${caller ?? "an unknown number"}.`, call.summary ?? "", excerpt(call.transcript), `Call: ${href}`].filter(Boolean).join("\n\n").slice(0, 20_000),
        ...(contactId ? { requesterId: contactId } : email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? { requesterEmail: email, requesterName: str(a.caller_name)?.slice(0, 200) } : {}),
        channel: "PHONE",
        priority: str(a.urgency) === "high" ? "HIGH" : str(a.urgency) === "low" ? "LOW" : "NORMAL",
        tags: ["phone", "ai-call"],
      }),
    );
    if (t) results.push({ type: "support_ticket", id: t.id, label: `Ticket #${t.number}`, href: `/support/tickets/${t.id}` });
  }

  await transaction(async (tx) => {
    // "Please don't call me again" is honoured immediately.
    if ((call.outcome === "DO_NOT_CALL" || a.do_not_call === true) && caller) {
      const existing = await tx.voiceDoNotCall.findUnique({ where: { companyId_phone: { companyId, phone: caller } } });
      const row = existing ?? (await tx.voiceDoNotCall.create({ data: { organizationId, companyId, phone: caller, source: "CALLER_REQUEST", reason: "Asked on an AI call not to be called again", callId: call.id } }));
      await tx.voiceCall.updateMany({ where: { companyId, toNumber: caller, direction: "OUTBOUND", status: { in: ["AWAITING_APPROVAL", "SCHEDULED"] } }, data: { status: "BLOCKED", blockedReason: "do_not_call" } });
      results.push({ type: "do_not_call", id: row.id, label: "Added to the do-not-call list", href: "/voice/settings" });
    }

    // Who hears about it: the requester (outbound); the message recipients (inbound messages and unrouted callers).
    const message = str(a.message_for_team);
    if (call.direction === "OUTBOUND" && call.requestedById && call.requestedById !== organizationId) {
      const n = await notifyUsers(tx, organizationId, [call.requestedById], "voice.call_completed", { companyId, title: `${who}: ${outcomeLabel(meetingBooked ? "MEETING_BOOKED" : call.outcome)}`, href });
      if (n) results.push({ type: "notification", id: call.requestedById, label: "Requester notified" });
    } else if (call.direction === "INBOUND" && connected && (message || call.outcome === "MESSAGE_TAKEN" || !results.some((r) => r.type === "lead" || r.type === "support_ticket"))) {
      const recipients = settings.voicemailUserId ? [settings.voicemailUserId] : await usersWithPermission(tx, organizationId, companyId, "communication.manage");
      const n = await notifyUsers(tx, organizationId, recipients, "voice.message", { companyId, title: `${who}: ${(message ?? call.summary ?? outcomeLabel(call.outcome)).slice(0, 140)}`, href });
      if (n) results.push({ type: "notification", id: call.id, label: `Message delivered to ${n} ${n === 1 ? "person" : "people"}` });
    }

    await tx.voiceCall.update({ where: { id: call.id }, data: { results: results as unknown as Prisma.InputJsonValue, processedAt: new Date() } });
    await writeAudit(tx, sys, { category: "TENANT", organizationId, action: "voice.call.processed", resourceType: "voice_call", resourceId: call.id, newValue: { outcome: call.outcome, records: results.map((r) => `${r.type}:${r.id}`) } });
    await emitVoiceEvent(tx, sys, "voice.call_completed", {
      organizationId,
      companyId,
      entityType: "voice_call",
      entityId: call.id,
      data: { direction: call.direction, outcome: meetingBooked ? "MEETING_BOOKED" : call.outcome, sentiment: call.sentiment, durationSec: call.durationSec, leadId, contactId },
    });
  });
  // Campaign calls: retry unanswered ones / schedule the callback the person asked for; roll up calling-run targets.
  await safe("follow_up_call", () => scheduleCampaignFollowUpCall(call.id));
  await safe("run_target", () => syncRunTargetForCall(call.id));
  return results.length;
}

/** Worker: ended calls whose final analysis never arrived (or whose processing failed) are processed after 10 minutes. */
export async function processStaleCalls(): Promise<number> {
  const rows = await db().voiceCall.findMany({ where: { status: { in: ["ENDED", "FAILED"] }, processedAt: null, externalCallId: { not: null }, updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, select: { id: true }, take: 25 });
  let n = 0;
  for (const r of rows) {
    try {
      await processCall(r.id);
      n++;
    } catch (err) {
      logger.warn({ callId: r.id, err: err instanceof Error ? err.message : err }, "voice post-call processing failed");
    }
  }
  return n;
}
