import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { MeetingIntelKind } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask } from "@/server/modules/agents/service";
import { searchKnowledge } from "@/server/modules/brain/knowledge";
import { activeConnection } from "@/server/modules/comms/connections-bridge";
import { googleListEvents, outlookListEvents } from "@/server/modules/comms/providers";
import { completeMeeting, getMeeting as getCommsMeeting, parseActionItems, updateMeeting as updateCommsMeeting } from "@/server/modules/comms/meetings";
import { composeEmail } from "@/server/modules/comms/email";
import { safeTimeZone, zonedParts, zonedTime } from "@/server/modules/comms/time";
import { getConnection } from "@/server/modules/integrations/connections";
import { providerFetch } from "@/server/modules/integrations/client";
import { requestTool } from "@/server/modules/tools/gateway";
import { authorize as authorizeComms } from "@/server/modules/comms/common";
import { addActivity, addFollowUp } from "./service";
import { addCrmActivity, addCrmFollowUp } from "./activities";
import { setCrmMeetingAgenda, updateMeetingStatus } from "./meetings";
import { suppressionFor } from "./suppression";
import { actorId, authorize, isUuid } from "./common";

/**
 * Meeting & communication intelligence for customer (CRM) and internal (Communication) meetings:
 *   availability   free slots from the connected Google / Microsoft calendar (busy events) and Realy's own meetings,
 *                  plus Calendly event-type availability when a Calendly connection exists
 *   prep           agenda + prep brief written by an AI employee task from CRM records and Company Brain passages
 *   transcript     pasted / uploaded text, or a Realy phone call's transcript
 *   processing     AI task → summary, decisions, action items, follow-up email draft, proposed outcome
 *   apply          only when a person confirms: tasks (CRM follow-ups / meeting action items), a CRM note, the
 *                  follow-up email (send_meeting_follow_up_email approval), and the meeting marked completed
 * AI output is stored only as returned by the task; nothing is applied, sent or completed automatically.
 */

export const INTEL_KINDS = ["CRM", "COMMS"] as const;
export const kindParam = (v: string): MeetingIntelKind | null => (v === "crm" ? "CRM" : v === "comms" ? "COMMS" : null);
const DAY = 86_400_000;

interface NormalizedMeeting {
  id: string;
  kind: MeetingIntelKind;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  agenda: string | null;
  notes: string | null;
  attendeeEmail: string | null;
  attendeeName: string | null;
  leadId: string | null;
  contactId: string | null;
  accountId: string | null;
  dealId: string | null;
  organizerId: string;
  outcome: string | null;
  people: string[];
}

async function loadMeeting(ctx: RequestContext, organizationId: string, companyId: string, kind: MeetingIntelKind, id: string, write = false): Promise<NormalizedMeeting> {
  if (!isUuid(id)) throw notFound("Meeting");
  if (kind === "CRM") {
    await authorize(ctx, organizationId, companyId, write ? "sales.manage" : "sales.read");
    const m = await db().crmMeeting.findFirst({ where: { id, organizationId, companyId } });
    if (!m) throw notFound("Meeting");
    return { ...m, kind, notes: null, people: [m.attendeeName ?? m.attendeeEmail ?? ""].filter(Boolean) };
  }
  await authorizeComms(ctx, organizationId, companyId, write ? "communication.post" : "communication.read");
  const m = await getCommsMeeting(ctx, organizationId, companyId, id);
  return {
    id: m.id,
    kind,
    title: m.title,
    startsAt: m.startsAt,
    endsAt: m.endsAt,
    status: m.status,
    agenda: m.agenda,
    notes: m.notes,
    attendeeEmail: null,
    attendeeName: null,
    leadId: null,
    contactId: null,
    accountId: null,
    dealId: null,
    organizerId: m.organizerId,
    outcome: null,
    people: [m.organizerName, ...m.attendees.map((a) => a.name)].filter((x): x is string => !!x),
  };
}

const ensureIntel = (organizationId: string, companyId: string, kind: MeetingIntelKind, meetingId: string) =>
  db().meetingIntel.upsert({ where: { companyId_kind_meetingId: { companyId, kind, meetingId } }, create: { organizationId, companyId, kind, meetingId }, update: {} });

// ───────────── Context (CRM + Brain), compiled from records only ─────────────

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : "");

async function crmContext(ctx: RequestContext, organizationId: string, companyId: string, m: NormalizedMeeting): Promise<string> {
  const out: string[] = [];
  const scope = { organizationId, companyId };
  if (m.leadId) {
    const l = await db().lead.findFirst({ where: { ...scope, id: m.leadId }, select: { name: true, account: true, stage: true, score: true, scoreLabel: true, source: true, notes: true, need: true, budget: true, authority: true, timeline: true, valueMinor: true, currency: true } });
    if (l) out.push(`Lead: ${l.name}${l.account ? ` (${l.account})` : ""} · stage ${l.stage} · score ${l.score} ${l.scoreLabel}${l.source ? ` · source ${l.source}` : ""}${l.valueMinor ? ` · est. value ${Number(l.valueMinor) / 100} ${l.currency}` : ""}`, [l.need && `Need: ${l.need}`, l.budget && `Budget: ${l.budget}`, l.authority && `Authority: ${l.authority}`, l.timeline && `Timeline: ${l.timeline}`].filter(Boolean).join("\n"), l.notes ? `Notes: ${clip(l.notes, 800)}` : "");
    const acts = await db().leadActivity.findMany({ where: { ...scope, leadId: m.leadId }, orderBy: { occurredAt: "desc" }, take: 8, select: { type: true, summary: true, occurredAt: true } });
    if (acts.length) out.push(`Recent activity:\n${acts.map((a) => `- ${a.occurredAt.toISOString().slice(0, 10)} ${a.type}: ${clip(a.summary, 240)}`).join("\n")}`);
    const fus = await db().leadFollowUp.findMany({ where: { ...scope, leadId: m.leadId, completedAt: null }, take: 5, select: { note: true, dueAt: true } });
    if (fus.length) out.push(`Open follow-ups:\n${fus.map((f) => `- ${f.dueAt.toISOString().slice(0, 10)} ${clip(f.note, 200)}`).join("\n")}`);
  }
  if (m.contactId) {
    const c = await db().contact.findFirst({ where: { ...scope, id: m.contactId }, select: { firstName: true, lastName: true, title: true, email: true, account: { select: { name: true, industry: true } } } });
    if (c) out.push(`Contact: ${[c.firstName, c.lastName].filter(Boolean).join(" ")}${c.title ? `, ${c.title}` : ""}${c.account ? ` at ${c.account.name}${c.account.industry ? ` (${c.account.industry})` : ""}` : ""}`);
    const acts = await db().crmActivity.findMany({ where: { ...scope, contactId: m.contactId }, orderBy: { occurredAt: "desc" }, take: 8, select: { type: true, summary: true, occurredAt: true } });
    if (acts.length) out.push(`Recent activity:\n${acts.map((a) => `- ${a.occurredAt.toISOString().slice(0, 10)} ${a.type}: ${clip(a.summary, 240)}`).join("\n")}`);
  }
  if (m.dealId) {
    const d = await db().crmDeal.findFirst({ where: { ...scope, id: m.dealId }, select: { name: true, amountMinor: true, currency: true, stage: { select: { name: true } } } });
    if (d) out.push(`Deal: ${d.name}${d.stage ? ` · stage ${d.stage.name}` : ""}${d.amountMinor ? ` · ${Number(d.amountMinor) / 100} ${d.currency}` : ""}`);
  }
  if (m.leadId || m.contactId) {
    const calls = await db().voiceCall.findMany({ where: { ...scope, status: "ENDED", ...(m.leadId ? { leadId: m.leadId } : { contactId: m.contactId }) }, orderBy: { createdAt: "desc" }, take: 3, select: { createdAt: true, outcome: true, summary: true } });
    if (calls.length) out.push(`Phone calls:\n${calls.map((c) => `- ${c.createdAt.toISOString().slice(0, 10)} ${c.outcome ?? "no outcome"}: ${clip(c.summary, 240)}`).join("\n")}`);
    const prior = await db().crmMeeting.findMany({ where: { ...scope, id: { not: m.id }, ...(m.leadId ? { leadId: m.leadId } : { contactId: m.contactId }) }, orderBy: { startsAt: "desc" }, take: 3, select: { title: true, startsAt: true, status: true, outcome: true } });
    if (prior.length) out.push(`Earlier meetings:\n${prior.map((p) => `- ${p.startsAt.toISOString().slice(0, 10)} ${p.title} (${p.status})${p.outcome ? `: ${clip(p.outcome, 200)}` : ""}`).join("\n")}`);
  }
  if (m.notes) out.push(`Meeting notes so far:\n${clip(m.notes, 2000)}`);
  // Company Brain passages (only what the requester may read).
  try {
    const k = await searchKnowledge(ctx, organizationId, companyId, [m.title, m.attendeeName].filter(Boolean).join(" "), 5);
    const passages = (k.passages ?? []).slice(0, 5).map((p) => `- ${p.title}: ${clip(p.snippet.map((s) => s.text).join(""), 300)}`);
    if (passages.length) out.push(`Company Brain:\n${passages.join("\n")}`);
  } catch (err) {
    logger.info({ err: err instanceof Error ? err.message : err }, "meeting intel: brain search skipped");
  }
  return out.filter(Boolean).join("\n\n").slice(0, 12_000);
}

// ───────────── Reads ─────────────

const TASK_SELECT = { id: true, status: true, output: true, createdAt: true, completedAt: true } as const;

/** Parse "## Heading" sections of an AI task output. */
function sections(output: string): Map<string, string> {
  const map = new Map<string, string>();
  let current: string | null = null;
  let buf: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const h = line.match(/^\s*#{1,3}\s+(.+?)\s*$/);
    if (h) {
      if (current) map.set(current, buf.join("\n").trim());
      current = h[1]!.toLowerCase();
      buf = [];
    } else buf.push(line);
  }
  if (current) map.set(current, buf.join("\n").trim());
  return map;
}
const pick = (m: Map<string, string>, ...names: string[]) => {
  for (const [k, v] of m) if (names.some((n) => k.startsWith(n))) return v;
  return null;
};
const bullets = (s: string | null) => (s ?? "").split(/\r?\n/).map((l) => l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/)?.[1]?.trim()).filter((x): x is string => !!x).slice(0, 50);

/** Materialize finished AI tasks into the intel row (idempotent; AI text is stored as returned, for review). */
async function syncTasks(intel: Awaited<ReturnType<typeof ensureIntel>>) {
  // A rejected / expired follow-up approval returns the email to an editable draft (nothing was sent).
  if (intel.followUpStatus === "AWAITING_APPROVAL" && intel.followUpApprovalId) {
    const a = await db().approval.findFirst({ where: { id: intel.followUpApprovalId }, select: { status: true } });
    if (a && ["REJECTED", "EXPIRED", "FAILED"].includes(a.status)) intel = await db().meetingIntel.update({ where: { id: intel.id }, data: { followUpStatus: "DRAFT", followUpApprovalId: null } });
  }
  const ids = [intel.prepTaskId, intel.processTaskId].filter((x): x is string => !!x);
  if (!ids.length) return intel;
  const tasks = await db().agentTask.findMany({ where: { id: { in: ids }, companyId: intel.companyId }, select: TASK_SELECT });
  const prep = tasks.find((t) => t.id === intel.prepTaskId);
  const proc = tasks.find((t) => t.id === intel.processTaskId);
  const data: Prisma.MeetingIntelUpdateInput = {};
  if (prep?.status === "COMPLETED" && prep.output && !intel.prepBuiltAt) {
    const s = sections(prep.output);
    data.prepBrief = (pick(s, "prep", "brief", "briefing") ?? prep.output).slice(0, 20_000);
    const agenda = pick(s, "agenda");
    if (agenda && !intel.agenda) data.agenda = agenda.slice(0, 5000);
    data.prepBuiltAt = prep.completedAt ?? new Date();
  }
  if (proc?.status === "COMPLETED" && proc.output && !intel.summary) {
    const s = sections(proc.output);
    data.summary = (pick(s, "summary") ?? "").slice(0, 10_000) || null;
    data.decisions = bullets(pick(s, "decision")).map((d) => d.slice(0, 1000));
    data.actionItems = parseActionItems(proc.output) as unknown as Prisma.InputJsonValue;
    data.proposedOutcome = (pick(s, "outcome") ?? "").slice(0, 2000) || null;
    const email = pick(s, "follow-up email", "follow up email", "email");
    if (email) {
      const subj = email.match(/^\s*subject:\s*(.+)$/im)?.[1]?.trim() ?? null;
      data.followUpSubject = subj?.slice(0, 300) ?? null;
      data.followUpBody = email.replace(/^\s*subject:.*$/im, "").trim().slice(0, 20_000) || null;
      if (data.followUpBody && intel.followUpStatus === "NONE") data.followUpStatus = "DRAFT";
    }
  }
  if (!Object.keys(data).length) return intel;
  return db().meetingIntel.update({ where: { id: intel.id }, data });
}

export async function getMeetingIntel(ctx: RequestContext, organizationId: string, companyId: string, kind: MeetingIntelKind, meetingId: string) {
  const meeting = await loadMeeting(ctx, organizationId, companyId, kind, meetingId);
  const row = await db().meetingIntel.findUnique({ where: { companyId_kind_meetingId: { companyId, kind, meetingId } } });
  const intel = row ? await syncTasks(row) : null;
  const taskIds = [intel?.prepTaskId, intel?.processTaskId].filter((x): x is string => !!x);
  const tasks = taskIds.length ? await db().agentTask.findMany({ where: { id: { in: taskIds }, companyId }, select: { id: true, status: true, errorMessage: true } }) : [];
  const calls =
    meeting.leadId || meeting.contactId
      ? await db().voiceCall.findMany({
          where: { organizationId, companyId, status: "ENDED", ...(meeting.leadId ? { leadId: meeting.leadId } : { contactId: meeting.contactId }), NOT: { transcript: { equals: [] } } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, createdAt: true, durationSec: true, outcome: true },
        })
      : [];
  return {
    meeting,
    intel,
    prepTask: tasks.find((t) => t.id === intel?.prepTaskId) ?? null,
    processTask: tasks.find((t) => t.id === intel?.processTaskId) ?? null,
    transcriptCalls: calls,
  };
}

/** Customer meetings with their intelligence state (for /communication/meetings/customer). */
export async function listCustomerMeetings(ctx: RequestContext, organizationId: string, companyId: string, opts: { scope?: "upcoming" | "past" } = {}) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const now = new Date();
  const rows = await db().crmMeeting.findMany({
    where: { organizationId, companyId, ...(opts.scope === "past" ? { startsAt: { lt: now } } : { endsAt: { gte: new Date(now.getTime() - 2 * 3_600_000) }, status: "SCHEDULED" }) },
    orderBy: { startsAt: opts.scope === "past" ? "desc" : "asc" },
    take: 50,
  });
  const intel = await db().meetingIntel.findMany({ where: { companyId, kind: "CRM", meetingId: { in: rows.map((r) => r.id) } }, select: { meetingId: true, prepBuiltAt: true, prepTaskId: true, transcriptAt: true, summary: true, appliedAt: true, followUpStatus: true } });
  const by = new Map(intel.map((i) => [i.meetingId, i]));
  return rows.map((r) => ({ ...r, intel: by.get(r.id) ?? null }));
}

// ───────────── Prep (agenda + brief) ─────────────

const PREP_INSTRUCTIONS = (m: NormalizedMeeting, context: string) => `Prepare the founder for this meeting. Use ONLY the facts below and what search_company_brain returns; if something is unknown, say it is unknown — never invent names, numbers, prices or history.

Meeting: ${m.title}
When: ${m.startsAt.toISOString()} – ${m.endsAt.toISOString()}
With: ${m.people.join(", ") || "not recorded"}
${m.agenda ? `Current agenda:\n${m.agenda}\n` : ""}
Facts from the CRM and Company Brain:
${context || "(no CRM records are linked to this meeting)"}

Write exactly these sections:
## Agenda
3–6 bullets with a time box each, ending with agreed next steps.
## Prep brief
Who they are, where the relationship stands, what they likely need, open questions to ask, risks and objections to expect, and the one outcome to aim for.`;

export async function generatePrep(ctx: RequestContext, organizationId: string, companyId: string, kind: MeetingIntelKind, meetingId: string) {
  const m = await loadMeeting(ctx, organizationId, companyId, kind, meetingId, true);
  if (m.status === "CANCELLED") throw conflict("This meeting was cancelled", { reason: "comms_intel_cancelled" });
  const context = await crmContext(ctx, organizationId, companyId, m);
  const task = await createTask(ctx, organizationId, companyId, {
    profile: "chief_of_staff",
    title: `Meeting prep: ${m.title}`.slice(0, 200),
    instructions: PREP_INSTRUCTIONS(m, context),
    subject: { type: kind === "CRM" ? "crm_meeting" : "meeting", id: m.id },
  });
  const intel = await ensureIntel(organizationId, companyId, kind, meetingId);
  await db().meetingIntel.update({ where: { id: intel.id }, data: { prepTaskId: task.id, prepBuiltAt: null, prepBrief: null } });
  return { taskId: task.id };
}

export const agendaInput = z.object({ agenda: z.string().trim().min(1).max(5000) }).strict();

/** Save the agenda on the meeting itself (and the intel row). */
export async function saveAgenda(ctx: RequestContext, organizationId: string, companyId: string, kind: MeetingIntelKind, meetingId: string, raw: z.input<typeof agendaInput>) {
  const { agenda } = agendaInput.parse(raw);
  await loadMeeting(ctx, organizationId, companyId, kind, meetingId, true);
  if (kind === "CRM") await setCrmMeetingAgenda(ctx, organizationId, companyId, meetingId, agenda);
  else await updateCommsMeeting(ctx, organizationId, companyId, meetingId, { agenda, scope: "this" });
  const intel = await ensureIntel(organizationId, companyId, kind, meetingId);
  await db().meetingIntel.update({ where: { id: intel.id }, data: { agenda } });
  return { ok: true };
}

// ───────────── Transcript → summary, action items, follow-up ─────────────

export const transcriptInput = z
  .object({
    source: z.enum(["upload", "voice_call"]),
    text: z.string().max(200_000).optional(),
    callId: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => (v.source === "upload" ? !!v.text?.trim() : !!v.callId), { message: "Paste the transcript or pick a call" });

export async function addTranscript(ctx: RequestContext, organizationId: string, companyId: string, kind: MeetingIntelKind, meetingId: string, raw: z.input<typeof transcriptInput>) {
  const input = transcriptInput.parse(raw);
  await loadMeeting(ctx, organizationId, companyId, kind, meetingId, true);
  let text = input.text?.trim() ?? "";
  if (input.source === "voice_call") {
    const call = await db().voiceCall.findFirst({ where: { id: input.callId, organizationId, companyId, status: "ENDED" }, select: { transcript: true } });
    if (!call) throw notFound("Call");
    const lines = (Array.isArray(call.transcript) ? call.transcript : []) as { role?: string; text?: string }[];
    text = lines.map((l) => `${l.role === "agent" ? "AI agent" : "Customer"}: ${l.text ?? ""}`).join("\n");
    if (!text) throw invalid("That call has no transcript", { reason: "comms_intel_no_transcript" });
  }
  // Uploaded subtitles (.vtt / .srt): drop cue numbers and timestamps.
  text = text.replace(/^WEBVTT.*$/m, "").replace(/^\d+\s*$/gm, "").replace(/^\d{2}:\d{2}(:\d{2})?[.,]\d{3}\s+-->\s+.*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  const intel = await ensureIntel(organizationId, companyId, kind, meetingId);
  return transaction(async (tx) => {
    const u = await tx.meetingIntel.update({
      where: { id: intel.id },
      data: { transcript: text.slice(0, 200_000), transcriptSource: input.source, transcriptCallId: input.callId ?? null, transcriptAt: new Date(), processTaskId: null, summary: null, decisions: [], actionItems: [], proposedOutcome: null, ...(intel.followUpStatus === "DRAFT" ? { followUpStatus: "NONE", followUpBody: null, followUpSubject: null } : {}) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "meeting.transcript_added", resourceType: kind === "CRM" ? "crm_meeting" : "meeting", resourceId: meetingId, newValue: { source: input.source, chars: text.length } });
    return { ok: true, chars: u.transcript?.length ?? 0 };
  });
}

const PROCESS_INSTRUCTIONS = (m: NormalizedMeeting, transcript: string, context: string) => `Process this meeting transcript. Use ONLY the transcript and the facts given; never invent commitments, dates, prices or attendees.

Meeting: ${m.title} (${m.startsAt.toISOString().slice(0, 10)}) with ${m.people.join(", ") || "unknown attendees"}
${context ? `Background:\n${context.slice(0, 4000)}\n` : ""}
Transcript:
"""
${transcript}
"""

Write exactly these sections:
## Summary
A short paragraph.
## Decisions
One bullet per decision (or "- None recorded").
## Action items
One bullet per action item: "- [Owner name] What to do (due YYYY-MM-DD)" — omit [..] or (due ..) when the transcript does not say.
## Follow-up email
First line "Subject: …", then a short, friendly plain-text email to the ${m.kind === "CRM" ? "customer" : "attendees"} recapping decisions and next steps. No placeholders like [Name].
## Outcome
One line: the meeting's outcome as stated in the transcript (e.g. "Agreed to a pilot starting 1 March"), or "Unclear".`;

export async function processTranscript(ctx: RequestContext, organizationId: string, companyId: string, kind: MeetingIntelKind, meetingId: string) {
  const m = await loadMeeting(ctx, organizationId, companyId, kind, meetingId, true);
  const intel = await ensureIntel(organizationId, companyId, kind, meetingId);
  if (!intel.transcript) throw invalid("Add a transcript first", { reason: "comms_intel_no_transcript" });
  const context = kind === "CRM" ? await crmContext(ctx, organizationId, companyId, m) : "";
  const transcript = intel.transcript.length > 60_000 ? `${intel.transcript.slice(0, 30_000)}\n…\n${intel.transcript.slice(-30_000)}` : intel.transcript;
  const task = await createTask(ctx, organizationId, companyId, {
    profile: "chief_of_staff",
    title: `Meeting summary: ${m.title}`.slice(0, 200),
    instructions: PROCESS_INSTRUCTIONS(m, transcript, context),
    subject: { type: kind === "CRM" ? "crm_meeting" : "meeting", id: m.id },
  });
  await db().meetingIntel.update({ where: { id: intel.id }, data: { processTaskId: task.id, summary: null } });
  return { taskId: task.id };
}

export const draftInput = z
  .object({
    summary: z.string().trim().max(10_000).optional(),
    actionItems: z.array(z.object({ title: z.string().trim().min(1).max(300), owner: z.string().trim().max(80).nullable().optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() })).max(50).optional(),
    followUpSubject: z.string().trim().max(300).optional(),
    followUpBody: z.string().trim().max(20_000).optional(),
  })
  .strict();

/** A person edits the AI draft before applying it. */
export async function updateIntelDraft(ctx: RequestContext, organizationId: string, companyId: string, kind: MeetingIntelKind, meetingId: string, raw: z.input<typeof draftInput>) {
  const input = draftInput.parse(raw);
  await loadMeeting(ctx, organizationId, companyId, kind, meetingId, true);
  const intel = await ensureIntel(organizationId, companyId, kind, meetingId);
  if (intel.followUpStatus === "AWAITING_APPROVAL" && (input.followUpBody !== undefined || input.followUpSubject !== undefined)) throw conflict("The email is waiting for approval; reject it first to edit", { reason: "comms_intel_email_pending" });
  return db().meetingIntel.update({
    where: { id: intel.id },
    data: {
      ...(input.summary !== undefined ? { summary: input.summary || null } : {}),
      ...(input.actionItems ? { actionItems: input.actionItems as unknown as Prisma.InputJsonValue } : {}),
      ...(input.followUpSubject !== undefined ? { followUpSubject: input.followUpSubject || null } : {}),
      ...(input.followUpBody !== undefined ? { followUpBody: input.followUpBody || null, followUpStatus: input.followUpBody ? (intel.followUpStatus === "SENT" ? "SENT" : "DRAFT") : "NONE" } : {}),
    },
  });
}

export const applyInput = z.object({ createTasks: z.boolean().default(true), addNote: z.boolean().default(true) }).strict();

/** Person-confirmed: action items → tasks, summary → CRM note. Runs once per processed transcript. */
export async function applyIntel(ctx: RequestContext, organizationId: string, companyId: string, kind: MeetingIntelKind, meetingId: string, raw: z.input<typeof applyInput>) {
  const input = applyInput.parse(raw);
  const m = await loadMeeting(ctx, organizationId, companyId, kind, meetingId, true);
  const intel = await ensureIntel(organizationId, companyId, kind, meetingId);
  if (!intel.summary && !(Array.isArray(intel.actionItems) && intel.actionItems.length)) throw invalid("Process the transcript first", { reason: "comms_intel_not_processed" });
  if (intel.appliedAt) throw conflict("These results were already applied", { reason: "comms_intel_applied" });
  const items = (Array.isArray(intel.actionItems) ? intel.actionItems : []) as { title: string; owner?: string | null; dueDate?: string | null }[];
  const results: { type: string; id: string; label: string; href?: string }[] = [];
  const due = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T09:00:00Z`).getTime() > Date.now() ? `${d}T09:00:00Z` : new Date(Date.now() + 2 * DAY).toISOString());
  if (input.createTasks && items.length) {
    if (kind === "CRM") {
      for (const it of items.slice(0, 20)) {
        const note = `${it.owner ? `[${it.owner}] ` : ""}${it.title} — from meeting "${m.title}"`.slice(0, 1000);
        const f = m.leadId
          ? await addFollowUp(ctx, organizationId, companyId, m.leadId, { dueAt: due(it.dueDate), note, priority: "MEDIUM" })
          : m.contactId || m.dealId
            ? await addCrmFollowUp(ctx, organizationId, companyId, { subjectType: m.contactId ? "contact" : "deal", subjectId: (m.contactId ?? m.dealId)!, dueAt: due(it.dueDate), note, priority: "MEDIUM" })
            : null;
        if (f) results.push({ type: "crm_follow_up", id: f.id, label: it.title.slice(0, 120), href: m.leadId ? `/crm/${m.leadId}` : m.contactId ? `/crm/contacts/${m.contactId}` : undefined });
      }
    } else {
      const { createActionItems } = await import("@/server/modules/comms/meetings");
      const r = await createActionItems(ctx, organizationId, companyId, meetingId, { items: items.slice(0, 50).map((i) => ({ title: i.title, dueDate: i.dueDate ?? null })) });
      for (const t of r.data) results.push({ type: "work_task", id: t.id, label: t.title.slice(0, 120), href: `/communication/meetings/${meetingId}` });
    }
  }
  if (input.addNote && intel.summary && kind === "CRM") {
    const summary = `Meeting notes — ${m.title}:\n${intel.summary}${intel.decisions.length ? `\n\nDecisions:\n${intel.decisions.map((d) => `- ${d}`).join("\n")}` : ""}`.slice(0, 5000);
    const a = m.leadId
      ? await addActivity(ctx, organizationId, companyId, m.leadId, { type: "NOTE", summary, occurredAt: new Date().toISOString() })
      : m.contactId || m.dealId
        ? await addCrmActivity(ctx, organizationId, companyId, { subjectType: m.contactId ? "contact" : "deal", subjectId: (m.contactId ?? m.dealId)!, type: "NOTE", subject: m.title.slice(0, 200), summary, occurredAt: new Date().toISOString() })
        : null;
    if (a) results.push({ type: "crm_note", id: a.id, label: "Meeting notes added to the CRM" });
  }
  if (input.addNote && intel.summary && kind === "COMMS") {
    await updateCommsMeeting(ctx, organizationId, companyId, meetingId, { notes: [m.notes, intel.summary].filter(Boolean).join("\n\n").slice(0, 50_000), ...(intel.decisions.length ? { decisions: intel.decisions.slice(0, 100) } : {}), scope: "this" });
    results.push({ type: "meeting_notes", id: meetingId, label: "Summary added to the meeting notes" });
  }
  return transaction(async (tx) => {
    const u = await tx.meetingIntel.update({ where: { id: intel.id }, data: { appliedAt: new Date(), appliedById: actorId(ctx, organizationId), results: results as unknown as Prisma.InputJsonValue } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "meeting.intel_applied", resourceType: kind === "CRM" ? "crm_meeting" : "meeting", resourceId: meetingId, newValue: { records: results.map((r) => `${r.type}:${r.id}`) } });
    return { ok: true, results: u.results };
  });
}

// ───────────── Follow-up email (approval) ─────────────

const UNSUBSCRIBE_LINE = "\n\n—\nIf you'd rather not receive follow-up emails from us, just reply \"unsubscribe\".";

/** File the follow-up email for approval (the approver sees the exact text). */
export async function requestFollowUpEmail(ctx: RequestContext, organizationId: string, companyId: string, kind: MeetingIntelKind, meetingId: string) {
  const m = await loadMeeting(ctx, organizationId, companyId, kind, meetingId, true);
  const intel = await ensureIntel(organizationId, companyId, kind, meetingId);
  if (!intel.followUpBody || !intel.followUpSubject) throw invalid("Write the follow-up email (subject and text) first", { reason: "comms_intel_no_email" });
  if (intel.followUpStatus === "AWAITING_APPROVAL" || intel.followUpStatus === "SENT") throw conflict(`The email is already ${intel.followUpStatus === "SENT" ? "sent" : "waiting for approval"}`, { reason: "comms_intel_email_state" });
  if (kind !== "CRM" || !m.attendeeEmail) throw invalid("This meeting has no customer email address", { reason: "comms_intel_no_recipient" });
  const hit = await suppressionFor(db(), companyId, m.attendeeEmail);
  if (hit) throw invalid("This address opted out of emails (suppression list)", { reason: "comms_intel_suppressed" });
  const r = await requestTool(
    "send_meeting_follow_up_email",
    { intelId: intel.id, to: m.attendeeEmail, subject: intel.followUpSubject, body: intel.followUpBody },
    { ctx, organizationId, companyId, allowedTools: ["send_meeting_follow_up_email"], profileKey: "chief_of_staff", taskId: null },
  );
  if (r.status === "approval_requested") {
    await db().meetingIntel.update({ where: { id: intel.id }, data: { followUpStatus: "AWAITING_APPROVAL", followUpApprovalId: r.approvalId } });
    return { status: "AWAITING_APPROVAL" as const, approvalId: r.approvalId };
  }
  const after = await db().meetingIntel.findUniqueOrThrow({ where: { id: intel.id }, select: { followUpStatus: true } });
  return { status: after.followUpStatus, approvalId: null };
}

/** Tool execution (after approval): send through the connected mailbox (or the platform mailer), record the truth. */
export async function sendFollowUpEmail(ctx: RequestContext, organizationId: string, companyId: string, input: { intelId: string; to: string; subject: string; body: string }) {
  const intel = await db().meetingIntel.findFirst({ where: { id: input.intelId, organizationId, companyId } });
  if (!intel) throw notFound("Meeting");
  if (intel.followUpStatus === "SENT") return { status: "SENT" as const, already: true };
  if (await suppressionFor(db(), companyId, input.to)) {
    await db().meetingIntel.update({ where: { id: intel.id }, data: { followUpStatus: "FAILED" } });
    throw new AppError("not_available", "The recipient opted out of emails; nothing was sent.", { reason: "comms_intel_suppressed" });
  }
  const meeting = intel.kind === "CRM" ? await db().crmMeeting.findFirst({ where: { id: intel.meetingId, companyId }, select: { contactId: true } }) : null;
  const r = await composeEmail(ctx, organizationId, companyId, { to: [input.to], cc: [], subject: input.subject, body: `${input.body}${UNSUBSCRIBE_LINE}`, contactId: meeting?.contactId ?? undefined });
  const sent = r.status === "SENT";
  await db().meetingIntel.update({ where: { id: intel.id }, data: { followUpStatus: sent ? "SENT" : "FAILED", results: [...((Array.isArray(intel.results) ? intel.results : []) as Prisma.InputJsonValue[]), { type: "email_thread", id: r.thread.id, label: sent ? "Follow-up email sent" : `Follow-up email not sent (${r.status})`, href: `/communication/inbox/${r.thread.id}` }] } });
  return { status: r.status, threadId: r.thread.id };
}

// ───────────── Outcome (person-confirmed) ─────────────

export const outcomeInput = z.object({ outcome: z.string().trim().min(1).max(2000) }).strict();

/** The only way a meeting becomes completed here: a person confirms it happened and states the outcome. */
export async function confirmMeetingOutcome(ctx: RequestContext, organizationId: string, companyId: string, kind: MeetingIntelKind, meetingId: string, raw: z.input<typeof outcomeInput>) {
  const { outcome } = outcomeInput.parse(raw);
  const m = await loadMeeting(ctx, organizationId, companyId, kind, meetingId, true);
  if (m.status !== "SCHEDULED") throw conflict("This meeting is already closed", { reason: "comms_intel_closed" });
  if (m.startsAt.getTime() > Date.now()) throw invalid("The meeting hasn't started yet", { reason: "comms_intel_future" });
  if (kind === "CRM") await updateMeetingStatus(ctx, organizationId, companyId, meetingId, { status: "COMPLETED", outcome });
  else {
    await updateCommsMeeting(ctx, organizationId, companyId, meetingId, { notes: [m.notes, `Outcome: ${outcome}`].filter(Boolean).join("\n\n").slice(0, 50_000), scope: "this" });
    await completeMeeting(ctx, organizationId, companyId, meetingId);
  }
  return { ok: true };
}

// ───────────── Availability ─────────────

export const availabilityInput = z
  .object({
    days: z.number().int().min(1).max(14).default(5),
    durationMin: z.number().int().min(15).max(240).default(30),
    workStartHour: z.number().int().min(0).max(23).default(9),
    workEndHour: z.number().int().min(1).max(24).default(17),
  })
  .strict();

type SourceState = "connected" | "not_connected" | "error";

/** Calendly (when connected): event types and their open times within the window (max 7 days per Calendly). */
async function calendlyAvailability(organizationId: string, companyId: string, from: Date, to: Date): Promise<{ state: SourceState; times: { eventType: string; startsAt: string; url: string | null }[] }> {
  const conn = await getConnection(organizationId, companyId, "calendly").catch(() => null);
  if (!conn?.accessToken) return { state: "not_connected", times: [] };
  try {
    const me = await providerFetch<{ resource?: { uri?: string } }>(conn, "https://api.calendly.com/users/me", { timeoutMs: 15_000 });
    const user = me.ok ? me.data.resource?.uri : null;
    if (!user) return { state: "error", times: [] };
    const types = await providerFetch<{ collection?: { uri: string; name: string; active?: boolean }[] }>(conn, `https://api.calendly.com/event_types?user=${encodeURIComponent(user)}&active=true&count=10`, { timeoutMs: 15_000 });
    const end = new Date(Math.min(to.getTime(), from.getTime() + 7 * DAY - 60_000));
    const start = new Date(Math.max(from.getTime(), Date.now() + 5 * 60_000));
    const times: { eventType: string; startsAt: string; url: string | null }[] = [];
    for (const t of (types.data.collection ?? []).slice(0, 3)) {
      const r = await providerFetch<{ collection?: { status?: string; start_time: string; scheduling_url?: string }[] }>(
        conn,
        `https://api.calendly.com/event_type_available_times?event_type=${encodeURIComponent(t.uri)}&start_time=${encodeURIComponent(start.toISOString())}&end_time=${encodeURIComponent(end.toISOString())}`,
        { timeoutMs: 15_000 },
      );
      for (const s of (r.data.collection ?? []).filter((x) => x.status === "available").slice(0, 8)) times.push({ eventType: t.name, startsAt: s.start_time, url: s.scheduling_url ?? null });
    }
    return { state: "connected", times };
  } catch {
    return { state: "error", times: [] };
  }
}

/** Free slots for the requester: connected calendar busy times + Realy meetings, in the company's time zone. */
export async function availability(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof availabilityInput>) {
  const input = availabilityInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "sales.read");
  if (input.workEndHour <= input.workStartHour) throw invalid("Working hours end before they start", { reason: "comms_intel_hours" });
  const company = await db().company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { timezone: true } });
  const tz = safeTimeZone(company.timezone);
  const from = new Date();
  const to = new Date(from.getTime() + (input.days + 4) * DAY);
  const me = ctx.actor.id;
  const busy: { s: number; e: number }[] = [];
  const sources: Record<"google" | "microsoft" | "calendly" | "realy", SourceState> = { google: "not_connected", microsoft: "not_connected", calendly: "not_connected", realy: "connected" };
  for (const [key, provider] of [["google", "google_calendar"], ["microsoft", "outlook_calendar"]] as const) {
    const conn = await activeConnection(organizationId, companyId, provider);
    if (!conn) continue;
    try {
      const events = provider === "google_calendar" ? await googleListEvents(conn, from, to) : await outlookListEvents(conn, from, to);
      for (const e of events) if (!e.cancelled) busy.push({ s: e.startsAt.getTime(), e: e.endsAt.getTime() });
      sources[key] = "connected";
    } catch {
      sources[key] = "error";
    }
  }
  if (me) {
    const [crm, comms] = await Promise.all([
      db().crmMeeting.findMany({ where: { organizationId, companyId, organizerId: me, status: "SCHEDULED", startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } }),
      db().commsMeeting.findMany({ where: { organizationId, companyId, status: "SCHEDULED", startsAt: { lt: to }, endsAt: { gt: from }, OR: [{ organizerId: me }, { attendees: { some: { userId: me } } }] }, select: { startsAt: true, endsAt: true } }),
    ]);
    for (const b of [...crm, ...comms]) busy.push({ s: b.startsAt.getTime(), e: b.endsAt.getTime() });
  }
  const dur = input.durationMin * 60_000;
  const slots: { startsAt: string; endsAt: string }[] = [];
  let examined = 0;
  for (let d = 0; examined < input.days && d < input.days + 10 && slots.length < 15; d++) {
    const p = zonedParts(tz, new Date(from.getTime() + d * DAY));
    if (p.isoWeekday > 5) continue;
    examined++;
    const open = zonedTime(tz, p.year, p.month, p.day, input.workStartHour, 0).getTime();
    const close = zonedTime(tz, p.year, p.month, p.day, input.workEndHour % 24, 0).getTime() + (input.workEndHour === 24 ? DAY : 0);
    let perDay = 0;
    for (let t = open; t + dur <= close && perDay < 3; t += 30 * 60_000) {
      if (t < from.getTime() + 30 * 60_000) continue;
      if (busy.some((b) => b.s < t + dur && b.e > t)) continue;
      slots.push({ startsAt: new Date(t).toISOString(), endsAt: new Date(t + dur).toISOString() });
      perDay++;
      t += dur - 30 * 60_000;
    }
  }
  const calendly = await calendlyAvailability(organizationId, companyId, from, to);
  sources.calendly = calendly.state;
  return { timeZone: tz, sources, slots, calendly: calendly.times, busyCount: busy.length };
}
