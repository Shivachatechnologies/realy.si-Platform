import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { createTask } from "@/server/modules/agents/service";
import { companyEmailProvider } from "@/server/modules/email/provider";
import { authorize } from "./common";
import { ensureSettings, listSlaPolicies, saveSlaPolicy } from "./config";

/**
 * Guided support setup (/support/setup): channels → response-time promises (an SLA policy written in plain words) →
 * first help-center articles drafted by AI (saved as drafts by the person) → inbox. Uses the existing settings, SLA and
 * knowledge-base services; SupportSettings.setupStep remembers where the person is.
 */
/** Promise options: [amount, unit]. A "day" is 8 working hours when only business hours count, otherwise 24 hours. */
export const RESPONSE_OPTIONS = { "1h": [1, "h"], "4h": [4, "h"], "1d": [1, "d"], "2d": [2, "d"] } as const;
export const RESOLVE_OPTIONS = { "1d": [1, "d"], "3d": [3, "d"], "1w": [5, "d"] } as const;
const minutes = ([n, unit]: readonly [number, "h" | "d"], businessHours: boolean) => n * (unit === "h" ? 60 : businessHours ? 8 * 60 : 24 * 60);
export const promiseInput = z.object({
  respond: z.enum(Object.keys(RESPONSE_OPTIONS) as [keyof typeof RESPONSE_OPTIONS, ...(keyof typeof RESPONSE_OPTIONS)[]]),
  resolve: z.enum(Object.keys(RESOLVE_OPTIONS) as [keyof typeof RESOLVE_OPTIONS, ...(keyof typeof RESOLVE_OPTIONS)[]]),
  businessHoursOnly: z.boolean().default(true),
});
export const draftArticleInput = z.object({ topic: z.string().trim().min(3).max(200), notes: z.string().trim().max(1500).optional() });

export const PROMISE_POLICY_NAME = "Our response promise";

/** Where the setup stands, from the real configuration. */
export async function setupState(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const [settings, policies, articles, published, tickets, email] = await Promise.all([
    ensureSettings(db(), organizationId, companyId),
    listSlaPolicies(ctx, organizationId, companyId),
    db().supportKbArticle.count({ where: { organizationId, companyId } }),
    db().supportKbArticle.count({ where: { organizationId, companyId, status: "PUBLISHED" } }),
    db().supportTicket.count({ where: { organizationId, companyId } }),
    companyEmailProvider(organizationId, companyId).catch(() => null),
  ]);
  // Customer email goes only through the company's own connected provider (see tickets.ts companyOnly).
  return { settings, policy: policies.find((p) => p.isDefault) ?? policies[0] ?? null, articles, published, tickets, emailReady: email?.scope === "company" };
}

/** Turn plain-language promises into an SLA policy: urgent issues get a quarter of the time, high half, low double. */
export async function savePromise(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof promiseInput>) {
  const input = promiseInput.parse(raw);
  const r = minutes(RESPONSE_OPTIONS[input.respond], input.businessHoursOnly);
  const s = minutes(RESOLVE_OPTIONS[input.resolve], input.businessHoursOnly) * (input.resolve === "1w" && !input.businessHoursOnly ? 7 / 5 : 1);
  const scale = (base: number, f: number) => Math.max(15, Math.round(base * f));
  const targets = {
    URGENT: { firstResponseMinutes: scale(r, 0.25), resolutionMinutes: scale(s, 0.25) },
    HIGH: { firstResponseMinutes: scale(r, 0.5), resolutionMinutes: scale(s, 0.5) },
    NORMAL: { firstResponseMinutes: r, resolutionMinutes: Math.round(s) },
    LOW: { firstResponseMinutes: scale(r, 2), resolutionMinutes: scale(s, 2) },
  };
  const existing = (await listSlaPolicies(ctx, organizationId, companyId)).find((p) => p.isDefault);
  return saveSlaPolicy(ctx, organizationId, companyId, existing?.id ?? null, {
    name: existing?.name ?? PROMISE_POLICY_NAME,
    isDefault: true,
    businessHoursOnly: input.businessHoursOnly,
    businessStartHour: existing?.businessStartHour ?? 9,
    businessEndHour: existing?.businessEndHour ?? 17,
    businessDays: existing?.businessDays ?? [1, 2, 3, 4, 5],
    targets,
  });
}

/** AI drafts one help-center article (a real support_lead task); the person reviews and saves it as a draft article. */
export async function draftArticle(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof draftArticleInput>) {
  const input = draftArticleInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "support.manage");
  return createTask(ctx, organizationId, companyId, {
    profile: "support_lead",
    title: `Help article: ${input.topic}`.slice(0, 200),
    subject: { type: "support_kb_draft", id: companyId },
    instructions: `Write a help-center article for customers on this topic: "${input.topic}".${input.notes ? ` Notes from the company: ${input.notes}` : ""} First check existing articles (search_kb_articles) so you don't duplicate them, and use the company's documents (search_company_brain) for facts. Never invent prices, policies or promises that are not in the documents — where facts are missing, write a clearly marked placeholder like [add your refund window]. Use friendly, plain language and short sections. Reply with the article only: the first line is "# " followed by the title, then the body.`,
  });
}

/** Split an AI article draft into title (first "# " line) and body. */
export function splitArticle(text: string, fallbackTitle: string) {
  const lines = text.trim().split("\n");
  const first = lines[0]?.match(/^#\s+(.+)/);
  return first ? { title: first[1]!.trim().slice(0, 200), body: lines.slice(1).join("\n").trim() } : { title: fallbackTitle.slice(0, 200), body: text.trim() };
}

/** Recent article drafting tasks (for resuming the articles step). */
export async function articleDraftTasks(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  return db().agentTask.findMany({
    where: { organizationId, companyId, subjectType: "support_kb_draft", subjectId: companyId },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, title: true, status: true, output: true, errorMessage: true },
  });
}

/** Ticket flow + live SLA timers + sentiment for the support workspace (real ticket data). */
export async function supportPulse(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const since = new Date(Date.now() - 14 * 86_400_000);
  const [byStatus, timers, recent] = await Promise.all([
    db().supportTicket.groupBy({ by: ["status"], where: { organizationId, companyId, OR: [{ status: { in: ["NEW", "OPEN", "PENDING", "ON_HOLD"] } }, { updatedAt: { gte: since } }] }, _count: { _all: true } }),
    db().supportTicket.findMany({
      where: { organizationId, companyId, status: { in: ["NEW", "OPEN", "PENDING", "ON_HOLD"] }, OR: [{ firstResponseDueAt: { not: null } }, { resolutionDueAt: { not: null } }] },
      orderBy: [{ resolutionDueAt: { sort: "asc", nulls: "last" } }],
      take: 40,
      select: { id: true, number: true, subject: true, priority: true, status: true, firstRespondedAt: true, firstResponseDueAt: true, resolutionDueAt: true },
    }),
    db().supportTicket.findMany({ where: { organizationId, companyId, createdAt: { gte: since } }, select: { classification: true, createdAt: true }, take: 2000 }),
  ]);
  const flow = Object.fromEntries(["NEW", "OPEN", "PENDING", "ON_HOLD", "SOLVED", "CLOSED"].map((s) => [s, byStatus.find((b) => b.status === s)?._count._all ?? 0])) as Record<string, number>;
  const due = (x: (typeof timers)[number]) => (!x.firstRespondedAt && x.firstResponseDueAt ? x.firstResponseDueAt : x.resolutionDueAt);
  const sla = timers
    .map((x) => ({ id: x.id, number: x.number, subject: x.subject, priority: x.priority, kind: !x.firstRespondedAt && x.firstResponseDueAt ? ("respond" as const) : ("resolve" as const), dueAt: due(x)! }))
    .filter((x) => x.dueAt)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .slice(0, 8);
  // Sentiment per day from the classifier stored on each ticket (classification.sentiment).
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10));
  const sentiment = days.map((d) => ({ day: d, positive: 0, neutral: 0, negative: 0 }));
  for (const r of recent) {
    const s = (r.classification as { sentiment?: string } | null)?.sentiment;
    const slot = sentiment.find((x) => x.day === r.createdAt.toISOString().slice(0, 10));
    if (!slot) continue;
    if (s === "positive") slot.positive++;
    else if (s === "negative") slot.negative++;
    else slot.neutral++;
  }
  return { flow, sla, sentiment };
}
