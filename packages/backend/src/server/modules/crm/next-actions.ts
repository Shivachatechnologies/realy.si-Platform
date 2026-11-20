import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { authorize, isUuid } from "./common";
import { addFollowUp, updateLead } from "./service";
import { addCrmFollowUp } from "./activities";
import { updateDeal } from "./deals";
import { enrichLead, qualifyLead } from "./intel";
import { aiOutreachDraft, type OutreachGoal } from "./outreach";

/**
 * "Next best action" for every open lead and deal: transparent rules over the real record (owner, email, follow-ups,
 * last contact, qualification, sequences, meetings, proposals, close date). Each action says why, and whether it is
 * internal (done right away when a person clicks), an AI draft (saved for approval — never sent), or a page to open.
 */

export type NbaKind =
  | "assign_me"
  | "add_email"
  | "enrich"
  | "first_email"
  | "overdue_follow_up"
  | "approve_email"
  | "qualify"
  | "follow_up_email"
  | "convert"
  | "plan_follow_up"
  | "reengage"
  | "set_close_date"
  | "close_date_passed"
  | "book_meeting"
  | "prepare_meeting"
  | "create_proposal"
  | "proposal_follow_up";

export type NbaRun = "execute" | "draft" | "link";

export interface NextAction {
  kind: NbaKind;
  /** 1 = do today, 2 = soon, 3 = when you can. */
  priority: 1 | 2 | 3;
  run: NbaRun;
  /** Opens a page (run "link"), relative to the locale. */
  href?: string;
  params: Record<string, string | number>;
}

export interface NbaSubject {
  type: "lead" | "deal";
  id: string;
  name: string;
  href: string;
  valueMinor: bigint | null;
  currency: string;
  ownerId: string | null;
  meta: string | null;
  actions: NextAction[];
}

const DAY = 86_400_000;
const DRAFT_GOAL: Partial<Record<NbaKind, OutreachGoal>> = { first_email: "first_touch", follow_up_email: "follow_up", reengage: "re_engage", proposal_follow_up: "proposal_follow_up", book_meeting: "book_meeting" };

type LeadRow = Awaited<ReturnType<typeof loadLeads>>[number];
type DealRow = Awaited<ReturnType<typeof loadDeals>>[number];

async function loadLeads(organizationId: string, companyId: string, ids?: string[]) {
  return db().lead.findMany({
    where: { organizationId, companyId, archivedAt: null, mergedIntoId: null, convertedAt: null, stage: { notIn: ["WON", "LOST"] }, ...(ids ? { id: { in: ids } } : {}) },
    orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
    take: ids ? ids.length : 300,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      account: true,
      stage: true,
      score: true,
      ownerId: true,
      qualified: true,
      valueMinor: true,
      currency: true,
      lastContactedAt: true,
      createdAt: true,
      followUps: { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 1, select: { dueAt: true, note: true } },
    },
  });
}

async function loadDeals(organizationId: string, companyId: string, ids?: string[]) {
  return db().crmDeal.findMany({
    where: { organizationId, companyId, archivedAt: null, status: "OPEN", ...(ids ? { id: { in: ids } } : {}) },
    orderBy: [{ amountMinor: "desc" }],
    take: ids ? ids.length : 300,
    select: {
      id: true,
      name: true,
      ownerId: true,
      amountMinor: true,
      currency: true,
      probability: true,
      expectedCloseDate: true,
      staleSince: true,
      stageEnteredAt: true,
      contactId: true,
      contact: { select: { email: true } },
      account: { select: { name: true } },
      stage: { select: { name: true, probability: true } },
      proposals: { where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, sentAt: true, viewedAt: true } },
      followUps: { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 1, select: { dueAt: true, note: true } },
      meetings: { where: { status: "SCHEDULED", endsAt: { gte: new Date(Date.now() - 2 * 3_600_000) } }, orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true, title: true } },
    },
  });
}

export function leadActions(l: LeadRow, x: { enrolled: boolean; pendingEmail: boolean; qualifiedByAi: boolean; enriched: boolean; meetingSoon: boolean; me: string | null }, now = new Date()): NextAction[] {
  const out: NextAction[] = [];
  const href = `/crm/${l.id}`;
  const fu = l.followUps[0];
  const quietDays = l.lastContactedAt ? Math.floor((now.getTime() - l.lastContactedAt.getTime()) / DAY) : null;
  if (x.pendingEmail) out.push({ kind: "approve_email", priority: 1, run: "link", href: "/crm/outreach", params: {} });
  if (fu && fu.dueAt <= now) out.push({ kind: "overdue_follow_up", priority: 1, run: "link", href, params: { note: fu.note.slice(0, 80) } });
  if (!l.ownerId && x.me) out.push({ kind: "assign_me", priority: 1, run: "execute", params: {} });
  if (!l.email && !l.phone) out.push({ kind: x.enriched ? "add_email" : "enrich", priority: 2, run: x.enriched || !l.account ? "link" : "execute", href, params: {} });
  if (l.email && !l.lastContactedAt && !x.enrolled && !x.pendingEmail) out.push({ kind: "first_email", priority: 1, run: "draft", params: {} });
  if (l.lastContactedAt && !l.qualified && !x.qualifiedByAi) out.push({ kind: "qualify", priority: 2, run: "execute", params: {} });
  if (l.qualified) out.push({ kind: "convert", priority: 2, run: "link", href: `${href}#convert`, params: {} });
  if (quietDays != null && quietDays >= 7 && l.email && !x.enrolled && !x.pendingEmail && !x.meetingSoon) out.push({ kind: quietDays >= 21 ? "reengage" : "follow_up_email", priority: quietDays >= 21 ? 2 : 1, run: "draft", params: { days: quietDays } });
  if (!fu && !x.enrolled) out.push({ kind: "plan_follow_up", priority: 3, run: "execute", params: {} });
  return out.sort((a, b) => a.priority - b.priority);
}

export function dealActions(d: DealRow, x: { pendingEmail: boolean; me: string | null }, now = new Date()): NextAction[] {
  const out: NextAction[] = [];
  const href = `/crm/deals/${d.id}`;
  const fu = d.followUps[0];
  const p = d.proposals[0];
  const meeting = d.meetings[0];
  const prob = d.probability ?? d.stage.probability;
  const hasEmail = !!d.contact?.email;
  if (x.pendingEmail) out.push({ kind: "approve_email", priority: 1, run: "link", href: "/crm/outreach", params: {} });
  if (fu && fu.dueAt <= now) out.push({ kind: "overdue_follow_up", priority: 1, run: "link", href, params: { note: fu.note.slice(0, 80) } });
  if (!d.ownerId && x.me) out.push({ kind: "assign_me", priority: 1, run: "execute", params: {} });
  if (meeting && meeting.startsAt.getTime() - now.getTime() < 2 * DAY) out.push({ kind: "prepare_meeting", priority: 1, run: "link", href, params: { title: meeting.title } });
  if (d.expectedCloseDate && d.expectedCloseDate < new Date(now.toISOString().slice(0, 10))) out.push({ kind: "close_date_passed", priority: 1, run: "link", href, params: {} });
  if (!d.expectedCloseDate) out.push({ kind: "set_close_date", priority: 3, run: "link", href, params: {} });
  if (p && (p.status === "SENT" || p.status === "VIEWED") && p.sentAt && now.getTime() - p.sentAt.getTime() > 3 * DAY && hasEmail && !x.pendingEmail)
    out.push({ kind: "proposal_follow_up", priority: 1, run: "draft", params: { viewed: p.viewedAt ? 1 : 0 } });
  if (!p && prob >= 40) out.push({ kind: "create_proposal", priority: 2, run: "link", href, params: {} });
  if (!meeting && prob < 60 && hasEmail && !x.pendingEmail) out.push({ kind: "book_meeting", priority: 2, run: "draft", params: {} });
  if (d.staleSince && hasEmail && !x.pendingEmail) out.push({ kind: "reengage", priority: 1, run: "draft", params: { days: Math.floor((now.getTime() - d.stageEnteredAt.getTime()) / DAY) } });
  if (!fu && !meeting) out.push({ kind: "plan_follow_up", priority: 3, run: "execute", params: {} });
  return out.sort((a, b) => a.priority - b.priority);
}

async function leadFacts(organizationId: string, companyId: string, ids: string[]) {
  if (!ids.length) return { enrolled: new Set<string>(), pending: new Set<string>(), aiQualified: new Set<string>(), enriched: new Set<string>(), meetings: new Set<string>() };
  const [enr, pend, intel, meet] = await Promise.all([
    db().crmCadenceEnrollment.findMany({ where: { companyId, leadId: { in: ids }, status: "ACTIVE" }, select: { leadId: true } }),
    db().crmOutreachMessage.findMany({ where: { companyId, organizationId, leadId: { in: ids }, status: "PENDING_APPROVAL" }, select: { leadId: true } }),
    db().crmIntel.findMany({ where: { companyId, leadId: { in: ids } }, select: { leadId: true, kind: true }, distinct: ["leadId", "kind"] }),
    db().crmMeeting.findMany({ where: { companyId, leadId: { in: ids }, status: "SCHEDULED", startsAt: { gte: new Date() } }, select: { leadId: true } }),
  ]);
  const set = (rows: { leadId: string | null }[]) => new Set(rows.map((r) => r.leadId!).filter(Boolean));
  return { enrolled: set(enr), pending: set(pend), aiQualified: set(intel.filter((i) => i.kind === "QUALIFICATION")), enriched: set(intel.filter((i) => i.kind === "ENRICHMENT")), meetings: set(meet) };
}

/** Ranked next actions across open leads and deals (Today page), or for one record. */
export async function nextActions(ctx: RequestContext, organizationId: string, companyId: string, f: { leadId?: string; dealId?: string; mine?: boolean } = {}) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const me = ctx.actor.id ?? null;
  const onlyLead = f.leadId && isUuid(f.leadId) ? [f.leadId] : undefined;
  const onlyDeal = f.dealId && isUuid(f.dealId) ? [f.dealId] : undefined;
  const [leads, deals] = await Promise.all([f.dealId ? Promise.resolve([]) : loadLeads(organizationId, companyId, onlyLead), f.leadId ? Promise.resolve([]) : loadDeals(organizationId, companyId, onlyDeal)]);
  const mine = (o: string | null) => !f.mine || o === me || o === null;
  const lf = await leadFacts(organizationId, companyId, leads.map((l) => l.id));
  const pendingDeals = deals.length
    ? new Set((await db().crmOutreachMessage.findMany({ where: { companyId, organizationId, dealId: { in: deals.map((d) => d.id) }, status: "PENDING_APPROVAL" }, select: { dealId: true } })).map((r) => r.dealId!))
    : new Set<string>();
  const subjects: NbaSubject[] = [
    ...leads.filter((l) => mine(l.ownerId)).map((l) => ({
      type: "lead" as const,
      id: l.id,
      name: l.name,
      href: `/crm/${l.id}`,
      valueMinor: l.valueMinor,
      currency: l.currency,
      ownerId: l.ownerId,
      meta: l.account,
      actions: leadActions(l, { enrolled: lf.enrolled.has(l.id), pendingEmail: lf.pending.has(l.id), qualifiedByAi: lf.aiQualified.has(l.id), enriched: lf.enriched.has(l.id), meetingSoon: lf.meetings.has(l.id), me }),
    })),
    ...deals.filter((d) => mine(d.ownerId)).map((d) => ({
      type: "deal" as const,
      id: d.id,
      name: d.name,
      href: `/crm/deals/${d.id}`,
      valueMinor: d.amountMinor,
      currency: d.currency,
      ownerId: d.ownerId,
      meta: [d.account?.name, d.stage.name].filter(Boolean).join(" · "),
      actions: dealActions(d, { pendingEmail: pendingDeals.has(d.id), me }),
    })),
  ].filter((s) => s.actions.length);
  // Most urgent first, then the bigger opportunity.
  subjects.sort((a, b) => a.actions[0]!.priority - b.actions[0]!.priority || Number((b.valueMinor ?? 0n) - (a.valueMinor ?? 0n)));
  return subjects;
}

export const runActionInput = z.object({ type: z.enum(["lead", "deal"]), id: z.string().uuid(), kind: z.string().max(40) });

/**
 * Do an action a person clicked. Internal changes happen right away (within the person's permissions); email actions
 * only create an AI draft that waits for approval in /crm/outreach. Returns what happened so the UI can say it.
 */
export async function runNextAction(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof runActionInput>) {
  const input = runActionInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "sales.manage");
  const current = await nextActions(ctx, organizationId, companyId, input.type === "lead" ? { leadId: input.id } : { dealId: input.id });
  const action = current[0]?.actions.find((a) => a.kind === input.kind);
  if (!current.length) throw notFound(input.type === "lead" ? "Lead" : "Deal");
  if (!action || action.run === "link") throw invalid("This action is no longer suggested for this record", { reason: "crm_nba_stale" });
  const me = ctx.actor.id;
  const inTwoDays = new Date(Date.now() + 2 * DAY).toISOString();
  switch (action.kind) {
    case "assign_me":
      if (!me) throw invalid("Only a person can take ownership");
      if (input.type === "lead") await updateLead(ctx, organizationId, companyId, input.id, { ownerId: me });
      else await updateDeal(ctx, organizationId, companyId, input.id, { ownerId: me });
      return { done: "assigned" as const };
    case "enrich":
      await enrichLead(ctx, organizationId, companyId, input.id);
      return { done: "enriched" as const };
    case "qualify":
      await qualifyLead(ctx, organizationId, companyId, input.id);
      return { done: "qualified" as const };
    case "plan_follow_up":
      if (input.type === "lead") await addFollowUp(ctx, organizationId, companyId, input.id, { dueAt: inTwoDays, note: "Check in and agree the next step", priority: "MEDIUM" });
      else await addCrmFollowUp(ctx, organizationId, companyId, { subjectType: "deal", subjectId: input.id, dueAt: inTwoDays, note: "Check in and agree the next step", priority: "MEDIUM" });
      return { done: "follow_up" as const };
    default: {
      const goal = DRAFT_GOAL[action.kind];
      if (!goal) throw invalid("This action can't be run automatically");
      const m = await aiOutreachDraft(ctx, organizationId, companyId, { ...(input.type === "lead" ? { leadId: input.id } : { dealId: input.id }), goal });
      return { done: "drafted" as const, outreachId: m.id };
    }
  }
}

/**
 * Real figures for the Today page header. The forecast is the weighted pipeline: each open deal's amount × its win
 * probability (deal's own, else the stage's), in the company currency (deals in other currencies are counted apart).
 */
export async function todaySnapshot(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const now = new Date();
  const [company, deals, pending, meetings, enrolled, due] = await Promise.all([
    db().company.findFirst({ where: { id: companyId, organizationId }, select: { baseCurrency: true } }),
    db().crmDeal.findMany({ where: { organizationId, companyId, status: "OPEN", archivedAt: null }, select: { amountMinor: true, currency: true, probability: true, status: true, stage: { select: { probability: true } } }, take: 5000 }),
    db().crmOutreachMessage.count({ where: { organizationId, companyId, status: "PENDING_APPROVAL" } }),
    db().crmMeeting.count({ where: { organizationId, companyId, status: "SCHEDULED", startsAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY) } } }),
    db().crmCadenceEnrollment.count({ where: { organizationId, companyId, status: "ACTIVE" } }),
    Promise.all([
      db().leadFollowUp.count({ where: { organizationId, companyId, completedAt: null, dueAt: { lte: new Date(now.getTime() + DAY) }, lead: { archivedAt: null } } }),
      db().crmFollowUp.count({ where: { organizationId, companyId, completedAt: null, dueAt: { lte: new Date(now.getTime() + DAY) } } }),
    ]).then(([a, b]) => a + b),
  ]);
  const currency = company?.baseCurrency ?? "EUR";
  let openMinor = 0n;
  let weightedMinor = 0n;
  let otherCurrency = 0;
  for (const d of deals) {
    if (d.currency !== currency) {
      otherCurrency++;
      continue;
    }
    openMinor += d.amountMinor;
    weightedMinor += (d.amountMinor * BigInt(d.probability ?? d.stage.probability)) / 100n;
  }
  return { currency, openMinor, weightedMinor, openDeals: deals.length - otherCurrency, otherCurrency, pending, meetings, enrolled, due };
}
