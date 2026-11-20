import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound, AppError } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { createTask, getTask } from "@/server/modules/agents/service";
import { sendPlainEmail } from "@/server/modules/email/service";
import { assistAccount, assistDeal } from "./ai-assist";
import { authorize, isUuid, moneyInput, uuid } from "./common";
import { convertLead } from "./conversion";
import { getDeal } from "./deals";
import { addStage, createPipeline } from "./pipelines";
import { addActivity, addFollowUp, createLead, getLead } from "./service";

/**
 * Guided "Start selling" journey (Sales OS) and the shared progress store for guided flows (GuidedFlowProgress).
 * Every step calls the existing CRM / agent services, so permissions, audit and domain events apply as usual; AI output is
 * only ever shown as produced by a real agent task, and AI-found leads become leads only after a person ticks them.
 */

// ───────────── Progress store (shared with Finance OS flows) ─────────────

export type FlowData = Record<string, unknown>;

export async function loadProgress(client: Tx | Db, companyId: string, flow: string) {
  return client.guidedFlowProgress.findUnique({ where: { companyId_flow: { companyId, flow } } });
}

export interface ProgressPatch {
  step?: number;
  data?: FlowData;
  /** Replace the data instead of merging it. */
  replace?: boolean;
  completed?: boolean;
  dismissed?: boolean;
}

/** Upsert a flow's progress (callers authorize first). `data` is shallow-merged into the stored object. */
export async function saveProgress(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, flow: string, patch: ProgressPatch) {
  const before = await loadProgress(tx, companyId, flow);
  const data = { ...(patch.replace ? {} : ((before?.data as FlowData | null) ?? {})), ...(patch.data ?? {}) } as Prisma.InputJsonValue;
  const fields = {
    ...(patch.step !== undefined ? { step: patch.step } : {}),
    data,
    ...(patch.completed !== undefined ? { completedAt: patch.completed ? new Date() : null } : {}),
    ...(patch.dismissed !== undefined ? { dismissedAt: patch.dismissed ? new Date() : null } : {}),
    updatedById: ctx.actor.id ?? null,
  };
  return before
    ? tx.guidedFlowProgress.update({ where: { id: before.id }, data: fields })
    : tx.guidedFlowProgress.create({ data: { organizationId, companyId, flow, step: patch.step ?? 0, ...fields } });
}

// ───────────── Journey data ─────────────

export const JOURNEY_FLOW = "sales_start";
export const JOURNEY_STEPS = ["sell", "icp", "lead", "research", "next", "message", "send", "track"] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];
const TASK_KEYS = ["icp", "find", "research", "next", "draft", "track"] as const;
type TaskKey = (typeof TASK_KEYS)[number];

export interface JourneyData {
  style?: string;
  pipelineId?: string;
  icpInput?: string;
  icp?: string;
  leadId?: string;
  addedLeadIds?: string[];
  tasks?: Partial<Record<TaskKey, string>>;
  message?: { subject: string; body: string };
  sent?: { status: string; at: string; subject: string };
  followUpAt?: string;
  dealId?: string;
}

export interface LeadCandidate {
  name: string;
  email?: string;
  company?: string;
  website?: string;
  reason?: string;
}

/** Leads proposed by the AI: the last ```json block of the deliverable with { "leads": [...] }. Nothing is created here. */
export function parseLeadCandidates(output: string | null | undefined): LeadCandidate[] {
  if (!output) return [];
  const blocks = [...output.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]!);
  for (const raw of blocks.reverse()) {
    try {
      const parsed = JSON.parse(raw) as { leads?: unknown };
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.leads) ? parsed.leads : null;
      if (!list) continue;
      const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
      return list
        .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}))
        .map((l) => ({ name: str(l.name, 200) ?? "", email: str(l.email, 254), company: str(l.company, 200), website: str(l.website, 300), reason: str(l.reason, 500) }))
        .filter((l) => l.name)
        .slice(0, 25);
    } catch {
      // not JSON — try the previous block
    }
  }
  return [];
}

/** "Subject: …" on the first lines, the rest is the body. */
export function parseDraft(output: string | null | undefined): { subject: string; body: string } | null {
  if (!output) return null;
  const text = output.replace(/```[a-z]*\n?/g, "").trim();
  const m = text.match(/^\s*\**\s*subject\s*\**\s*:\s*(.+)$/im);
  if (!m) return { subject: "", body: text.slice(0, 5000) };
  const after = text.slice((m.index ?? 0) + m[0].length).replace(/^\s*-{3,}\s*$/m, "").trim();
  return { subject: m[1]!.replace(/\*+/g, "").trim().slice(0, 200), body: after.slice(0, 5000) };
}

async function taskSummary(ctx: RequestContext, organizationId: string, companyId: string, id: string | undefined) {
  if (!id) return null;
  try {
    const t = await getTask(ctx, organizationId, companyId, id);
    return { id: t.id, status: t.status, title: t.title, output: t.output ?? null, createdAt: t.createdAt };
  } catch {
    return null;
  }
}

/** Journey state for the page: saved answers, the AI tasks it started (real status/output) and the records it created. */
export async function getJourney(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const row = await loadProgress(db(), companyId, JOURNEY_FLOW);
  const data = ((row?.data as JourneyData | null) ?? {}) as JourneyData;
  const entries = await Promise.all(TASK_KEYS.map(async (k) => [k, await taskSummary(ctx, organizationId, companyId, data.tasks?.[k])] as const));
  const tasks = Object.fromEntries(entries) as Record<TaskKey, Awaited<ReturnType<typeof taskSummary>>>;
  const lead = data.leadId
    ? await db().lead.findFirst({
        where: { id: data.leadId, organizationId, companyId },
        select: { id: true, name: true, email: true, account: true, stage: true, score: true, scoreLabel: true, convertedAt: true, convertedDealId: true, archivedAt: true },
      })
    : null;
  const dealId = data.dealId ?? lead?.convertedDealId ?? null;
  const deal = dealId
    ? await db().crmDeal.findFirst({
        where: { id: dealId, organizationId, companyId },
        select: { id: true, name: true, status: true, amountMinor: true, currency: true, stage: { select: { name: true } }, pipeline: { select: { stages: { where: { archivedAt: null }, orderBy: { position: "asc" }, select: { id: true, name: true, type: true } } } }, stageId: true },
      })
    : null;
  const added = data.addedLeadIds?.length
    ? await db().lead.findMany({ where: { id: { in: data.addedLeadIds }, organizationId, companyId, archivedAt: null }, select: { id: true, name: true, account: true } })
    : [];
  return {
    id: row?.id ?? null,
    step: row?.step ?? 0,
    completedAt: row?.completedAt ?? null,
    dismissedAt: row?.dismissedAt ?? null,
    data,
    tasks,
    candidates: parseLeadCandidates(tasks.find?.output),
    draft: parseDraft(tasks.draft?.output),
    lead,
    deal,
    addedLeads: added,
  };
}

/** The saved ideal customer profile (shown in CRM settings and given to AI sales tasks). */
export async function idealCustomerProfile(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const row = await loadProgress(db(), companyId, JOURNEY_FLOW);
  return ((row?.data as JourneyData | null)?.icp as string | undefined) ?? null;
}

/** Whether the company has no sales data yet and hasn't finished or dismissed the journey (→ show the journey first). */
export async function shouldStartJourney(organizationId: string, companyId: string) {
  const [row, leads, deals] = await Promise.all([
    loadProgress(db(), companyId, JOURNEY_FLOW),
    db().lead.count({ where: { organizationId, companyId } }),
    db().crmDeal.count({ where: { organizationId, companyId } }),
  ]);
  return !row?.completedAt && !row?.dismissedAt && leads === 0 && deals === 0;
}

// ───────────── Journey actions ─────────────

/** Stages in the order given with rising probabilities, then Won and Lost. */
async function addPipelineStages(ctx: RequestContext, organizationId: string, companyId: string, pipelineId: string, names: string[], wonName: string, lostName: string) {
  const n = names.length;
  for (const [i, name] of names.entries()) {
    await addStage(ctx, organizationId, companyId, pipelineId, { name, probability: Math.round(((i + 1) / (n + 1)) * 90), type: "OPEN", position: i });
  }
  await addStage(ctx, organizationId, companyId, pipelineId, { name: wonName, probability: 100, type: "WON", position: n });
  await addStage(ctx, organizationId, companyId, pipelineId, { name: lostName, probability: 0, type: "LOST", position: n + 1 });
}

const leadForm = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254).optional().or(z.literal("").transform(() => undefined)),
  phone: z.string().trim().max(40).optional(),
  account: z.string().trim().max(200).optional(),
  value: moneyInput.optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(5000).optional(),
});

export const journeyPatchInput = z.object({
  step: z.number().int().min(0).max(JOURNEY_STEPS.length - 1).optional(),
  dismissed: z.boolean().optional(),
  restart: z.boolean().optional(),
});

export const journeyActionInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("pipeline"),
    style: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(100),
    stages: z.array(z.string().trim().min(1).max(100)).min(1).max(8),
    wonName: z.string().trim().min(1).max(100),
    lostName: z.string().trim().min(1).max(100),
  }),
  z.object({ action: z.literal("icp_ai"), description: z.string().trim().min(10).max(3000) }),
  z.object({ action: z.literal("icp_save"), icp: z.string().trim().min(3).max(8000), description: z.string().trim().max(3000).optional(), keepStep: z.boolean().optional() }),
  z.object({ action: z.literal("find_leads"), count: z.number().int().min(1).max(20).default(10), where: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("add_lead"), lead: leadForm }),
  z.object({ action: z.literal("add_leads"), leads: z.array(leadForm.extend({ reason: z.string().trim().max(500).optional(), website: z.string().trim().max(300).optional() })).min(1).max(25) }),
  z.object({ action: z.literal("select_lead"), leadId: uuid }),
  z.object({ action: z.literal("research") }),
  z.object({ action: z.literal("next_action") }),
  z.object({ action: z.literal("draft"), tone: z.string().trim().max(200).optional() }),
  z.object({ action: z.literal("save_message"), subject: z.string().trim().max(200), body: z.string().trim().max(5000) }),
  z.object({ action: z.literal("send"), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000) }),
  z.object({ action: z.literal("follow_up"), dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal("track"), amount: moneyInput.optional().or(z.literal("").transform(() => undefined)) }),
  z.object({ action: z.literal("watch_deal") }),
  z.object({ action: z.literal("complete") }),
]);
export type JourneyAction = z.input<typeof journeyActionInput>;

async function update(ctx: RequestContext, organizationId: string, companyId: string, patch: ProgressPatch) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    return saveProgress(tx, ctx, organizationId, companyId, JOURNEY_FLOW, patch);
  });
}

async function current(companyId: string) {
  const row = await loadProgress(db(), companyId, JOURNEY_FLOW);
  return ((row?.data as JourneyData | null) ?? {}) as JourneyData;
}

/** Ask AI to answer in the person's language (locale code from the UI). */
export const langLine = (locale?: string | null) => (locale && /^[a-z]{2}(-[A-Z]{2})?$/.test(locale) ? `\n\nWrite your answer in the language of the locale "${locale}".` : "");
const stepIndex = (s: JourneyStep) => JOURNEY_STEPS.indexOf(s);
const icpLine = (d: JourneyData) => (d.icp ? `\n\nThe company's ideal customer profile:\n${d.icp.slice(0, 3000)}` : "");

function requireLead(d: JourneyData) {
  if (!d.leadId) throw invalid("Add or choose a customer first", { reason: "crm_journey_no_lead" });
  return d.leadId;
}

export async function updateJourney(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof journeyPatchInput>) {
  const input = journeyPatchInput.parse(raw);
  if (input.restart) return update(ctx, organizationId, companyId, { step: 0, data: {}, replace: true, completed: false, dismissed: false });
  return update(ctx, organizationId, companyId, { step: input.step, dismissed: input.dismissed });
}

/** Run one journey step through the existing services and remember what it produced. */
export async function journeyAction(ctx: RequestContext, organizationId: string, companyId: string, raw: JourneyAction, opts: { locale?: string | null } = {}) {
  const input = journeyActionInput.parse(raw);
  const ai = (args: Parameters<typeof createTask>[3]) => createTask(ctx, organizationId, companyId, { ...args, instructions: `${args.instructions}${langLine(opts.locale)}` });
  const d = await current(companyId);
  const tasks = { ...(d.tasks ?? {}) };
  switch (input.action) {
    case "pipeline": {
      if (d.pipelineId && (await db().crmPipeline.findFirst({ where: { id: d.pipelineId, companyId, archivedAt: null }, select: { id: true } }))) {
        return update(ctx, organizationId, companyId, { step: stepIndex("icp"), data: { style: input.style } });
      }
      const p = await createPipeline(ctx, organizationId, companyId, { name: input.name, isDefault: true, withDefaultStages: false });
      await addPipelineStages(ctx, organizationId, companyId, p.id, input.stages, input.wonName, input.lostName);
      return update(ctx, organizationId, companyId, { step: stepIndex("icp"), data: { style: input.style, pipelineId: p.id } });
    }
    case "icp_ai": {
      const task = await ai({
        profile: "sales_researcher",
        title: "Ideal customer profile",
        instructions: [
          `The founder describes their potential customers in plain words: "${input.description}"`,
          "Use the Company Brain and what you know about the company's products. Write a clear ideal customer profile (ICP) in plain language a beginner understands: (1) who they are (industry, size, location, role of the buyer), (2) the problem they have that we solve, (3) signs that someone is a good fit, (4) signs that someone is NOT a fit, (5) where to find them and how they like to be approached. Keep it under 300 words, no jargon. Do not create records.",
        ].join("\n\n"),
        subject: { type: "sales_journey", id: companyId },
      });
      tasks.icp = task.id;
      return update(ctx, organizationId, companyId, { data: { icpInput: input.description, tasks } });
    }
    case "icp_save":
      return update(ctx, organizationId, companyId, { ...(input.keepStep ? {} : { step: stepIndex("lead") }), data: { icp: input.icp, ...(input.description ? { icpInput: input.description } : {}) } });
    case "find_leads": {
      const task = await ai({
        profile: "sdr",
        title: "Find potential customers",
        instructions: [
          `Find up to ${input.count} real potential customers (businesses or people) that match the ideal customer profile below${input.where ? `, focusing on: ${input.where}` : ""}.`,
          "If the web_research tool is available, use it to find real, verifiable organizations and public contact details; otherwise use the Company Brain and the company graph. Never invent people, companies or email addresses: leave a field out when you could not verify it. Check read_leads so you don't suggest existing leads.",
          'Do NOT call create_lead — the person picks which suggestions to add. End your deliverable with one fenced ```json block of the form {"leads":[{"name":"…","company":"…","email":"…","website":"…","reason":"why they fit"}]}.',
        ].join("\n\n") + icpLine(d),
        subject: { type: "sales_journey", id: companyId },
      });
      tasks.find = task.id;
      return update(ctx, organizationId, companyId, { data: { tasks } });
    }
    case "add_lead": {
      const lead = await createLead(ctx, organizationId, companyId, { ...input.lead, source: "Start selling" });
      return update(ctx, organizationId, companyId, { step: stepIndex("research"), data: { leadId: lead.id, addedLeadIds: [...(d.addedLeadIds ?? []), lead.id] } });
    }
    case "add_leads": {
      const created: string[] = [];
      const skipped: string[] = [];
      for (const l of input.leads) {
        try {
          const lead = await createLead(ctx, organizationId, companyId, {
            name: l.name,
            email: l.email,
            account: l.account,
            source: "AI lead research",
            notes: [l.reason, l.website].filter(Boolean).join("\n") || undefined,
          });
          created.push(lead.id);
        } catch (err) {
          if (err instanceof AppError && err.code === "conflict") skipped.push(l.name);
          else throw err;
        }
      }
      const leadId = d.leadId ?? created[0];
      await update(ctx, organizationId, companyId, { ...(leadId && !d.leadId ? { step: stepIndex("research") } : {}), data: { leadId, addedLeadIds: [...(d.addedLeadIds ?? []), ...created] } });
      return { created: created.length, skipped };
    }
    case "select_lead": {
      await getLead(ctx, organizationId, companyId, input.leadId);
      return update(ctx, organizationId, companyId, { step: stepIndex("research"), data: { leadId: input.leadId, dealId: undefined, sent: undefined, message: undefined } });
    }
    case "research": {
      const leadId = requireLead(d);
      const lead = await getLead(ctx, organizationId, companyId, leadId);
      const task = await ai({
        profile: "sdr",
        title: `Customer research: ${lead.name}`.slice(0, 200),
        instructions:
          `Call read_lead with leadId ${lead.id}${lead.account ? ` and research the organization "${lead.account}"` : ""} (use web_research if it is available, otherwise the Company Brain). Write a short research brief in plain language: (1) who they are, (2) what they probably need and why we can help, (3) how well they fit the ideal customer profile (fit score 1–10 with reasons), (4) questions to ask them. Say clearly what you could not verify.` +
          icpLine(d),
        leadId: lead.id,
        subject: { type: "lead", id: lead.id },
      });
      tasks.research = task.id;
      return update(ctx, organizationId, companyId, { data: { tasks } });
    }
    case "next_action": {
      const leadId = requireLead(d);
      const task = await ai({
        profile: "sdr",
        title: "Recommended next step",
        instructions:
          `Call read_lead with leadId ${leadId}. Recommend the single best next action for this customer in one or two plain sentences a beginner can follow (what to do, when, and why), then two alternatives. If a follow-up reminder makes sense, propose it with create_follow_up (subjectType "lead", subjectId ${leadId}); it is created only after approval.` +
          icpLine(d),
        leadId,
        subject: { type: "lead", id: leadId },
      });
      tasks.next = task.id;
      return update(ctx, organizationId, companyId, { data: { tasks } });
    }
    case "draft": {
      const leadId = requireLead(d);
      const task = await ai({
        profile: "sdr",
        title: "Personalized first message",
        instructions:
          `Call read_lead with leadId ${leadId}. Write a short, personal first email to this customer that references concrete facts from the record and the research, explains in one sentence how we help, and ends with one easy question.${input.tone ? ` Tone: ${input.tone}.` : ""} Output exactly: a first line "Subject: <subject>" (keep the word "Subject:" in English), a blank line, then the plain-text body. Do not call send_lead_email and never say it was sent.` +
          icpLine(d),
        leadId,
        subject: { type: "lead", id: leadId },
      });
      tasks.draft = task.id;
      return update(ctx, organizationId, companyId, { data: { tasks } });
    }
    case "save_message":
      return update(ctx, organizationId, companyId, { data: { message: { subject: input.subject, body: input.body } } });
    case "send": {
      const leadId = requireLead(d);
      const r = await sendLeadMessage(ctx, organizationId, companyId, leadId, { subject: input.subject, body: input.body });
      await update(ctx, organizationId, companyId, {
        ...(r.status === "SENT" ? { step: stepIndex("track") } : {}),
        data: { message: { subject: input.subject, body: input.body }, sent: { status: r.status, at: new Date().toISOString(), subject: input.subject } },
      });
      return r;
    }
    case "follow_up": {
      const leadId = requireLead(d);
      await addFollowUp(ctx, organizationId, companyId, leadId, { dueAt: input.dueAt, note: input.note, priority: "MEDIUM" });
      return update(ctx, organizationId, companyId, { step: stepIndex("track"), data: { followUpAt: input.dueAt } });
    }
    case "track": {
      const leadId = requireLead(d);
      const lead = await getLead(ctx, organizationId, companyId, leadId);
      let dealId = d.dealId ?? lead.convertedDealId ?? null;
      if (!dealId) {
        if (lead.convertedAt) throw conflict("This lead was converted without a deal", { reason: "crm_lead_converted" });
        const r = await convertLead(ctx, organizationId, companyId, leadId, { createDeal: true, accountType: "PROSPECT", amount: input.amount, pipelineId: d.pipelineId });
        dealId = r.dealId;
      }
      return update(ctx, organizationId, companyId, { data: { dealId: dealId ?? undefined } });
    }
    case "watch_deal": {
      if (!d.dealId) throw invalid("Create the deal first", { reason: "crm_journey_no_deal" });
      const task = await assistDeal(ctx, organizationId, companyId, d.dealId, { mode: "next_action", guidance: `This deal was just created from the guided Start selling journey; explain in plain words what to do next to win it.${langLine(opts.locale)}`.slice(0, 1000) });
      tasks.track = task.id;
      return update(ctx, organizationId, companyId, { data: { tasks } });
    }
    case "complete":
      return update(ctx, organizationId, companyId, { completed: true });
  }
}

// ───────────── Email a lead (written or approved by a person) ─────────────

export const leadMessageInput = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000) });

/**
 * Send an email a person wrote (or edited from an AI draft) to the lead's address. The status is whatever the provider
 * said: an activity is recorded only when the message was accepted (SENT); NOT_CONFIGURED / FAILED change nothing.
 */
export async function sendLeadMessage(ctx: RequestContext, organizationId: string, companyId: string, leadId: string, raw: z.input<typeof leadMessageInput>) {
  const input = leadMessageInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "sales.manage");
  const lead = await getLead(ctx, organizationId, companyId, leadId);
  if (lead.archivedAt) throw conflict("The lead is archived", { reason: "crm_lead_archived" });
  if (!lead.email) throw conflict("The lead has no email address", { reason: "crm_lead_no_email" });
  const r = await sendPlainEmail({ to: lead.email, subject: input.subject, text: input.body, template: "lead_message", organizationId, userId: ctx.actor.id ?? null });
  if (r.status === "SENT") {
    await addActivity(ctx, organizationId, companyId, leadId, { type: "EMAIL", summary: `Sent: ${input.subject}\n\n${input.body}`.slice(0, 5000) });
  }
  await transaction((tx) =>
    writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "lead.email_sent", resourceType: "lead", resourceId: leadId, newValue: { status: r.status, subject: input.subject } }),
  );
  return { status: r.status };
}

// ───────────── "Help me do this" ─────────────

export const helpInput = z.object({
  kind: z.enum(["lead", "deal", "account", "page"]),
  id: uuid.optional(),
  /** Page key, e.g. "crm.deals" or "sales.overview". */
  page: z.string().trim().regex(/^[a-zA-Z0-9_.-]{1,60}$/),
  /** What the person wants help with (optional). */
  request: z.string().trim().max(1000).optional(),
  locale: z.string().max(10).optional(),
});

/** Creates an AI task with the right sales profile, linked to the record (or the page), carrying the page context. */
export async function helpMe(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof helpInput>) {
  const input = helpInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "sales.read");
  const ask = (input.request ? `\n\nThe person asks: "${input.request}"` : "") + langLine(input.locale);
  const plain = "Explain in plain words for someone without sales experience. Finish with a numbered list of the next 1–3 concrete steps they can take in Realy.si, and propose follow-ups with create_follow_up when useful (they need approval). Never claim something was sent or changed unless a tool result says so.";
  const icp = await idealCustomerProfile(ctx, organizationId, companyId).catch(() => null);
  const icpText = icp ? `\n\nIdeal customer profile:\n${icp.slice(0, 2000)}` : "";
  if (input.kind === "lead") {
    if (!input.id || !isUuid(input.id)) throw notFound("Lead");
    const lead = await getLead(ctx, organizationId, companyId, input.id);
    return createTask(ctx, organizationId, companyId, {
      profile: "sdr",
      title: `Help: ${lead.name}`.slice(0, 200),
      instructions: `The person is on the page of lead ${lead.name} and pressed "Help me do this". Call read_lead with leadId ${lead.id}, then help them move this lead forward: where it stands, what is missing, and the best next step. ${plain}${ask}${icpText}`,
      leadId: lead.id,
      subject: { type: "lead", id: lead.id },
    });
  }
  if (input.kind === "deal") {
    if (!input.id) throw notFound("Deal");
    const deal = await getDeal(ctx, organizationId, companyId, input.id);
    return assistDeal(ctx, organizationId, companyId, deal.id, { mode: "next_action", guidance: `The person pressed "Help me do this" on this deal. ${plain}${ask}`.slice(0, 1000) });
  }
  if (input.kind === "account") {
    if (!input.id) throw notFound("Account");
    return assistAccount(ctx, organizationId, companyId, input.id, { mode: "next_action", guidance: `The person pressed "Help me do this" on this customer. ${plain}${ask}`.slice(0, 1000) });
  }
  return createTask(ctx, organizationId, companyId, {
    profile: "sales_manager",
    title: `Help: ${input.page}`.slice(0, 200),
    instructions: `The person is on the "${input.page}" page of the CRM / Sales area and pressed "Help me do this". Read the pipeline (read_pipeline_summary, read_deals, read_leads) to understand where they stand, explain what this page is for and what they should do on it right now based on their real data. ${plain}${ask}${icpText}`,
    subject: { type: "crm_page", id: companyId },
  });
}

// ───────────── Sales OS: AI recommendations rail ─────────────

const SALES_SUBJECTS = ["lead", "crm_deal", "account", "crm_pipeline", "crm_page", "sales_journey"];

/** Latest AI sales tasks (finished or in progress) with their real output, for the next-actions rail. */
export async function recentSalesAiTasks(ctx: RequestContext, organizationId: string, companyId: string, take = 6) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  try {
    await requirePermission(ctx, "agents.read", await companyChain(db(), organizationId, companyId));
  } catch {
    return [];
  }
  return db().agentTask.findMany({
    where: { organizationId, companyId, OR: [{ subjectType: { in: SALES_SUBJECTS } }, { leadId: { not: null } }], status: { in: ["QUEUED", "RUNNING", "COMPLETED"] } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, title: true, status: true, output: true, subjectType: true, subjectId: true, leadId: true, createdAt: true },
  });
}
