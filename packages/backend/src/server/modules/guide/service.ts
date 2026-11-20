import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask } from "@/server/modules/agents/service";
import { profileByKey } from "@/server/modules/agents/profiles";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";
import { getT } from "@/i18n/server";
import { DEFAULT_LOCALE, isAppLocale, LOCALE_NAMES, LOCALES, type AppLocale } from "@/i18n/config";
import { guidePageByKey, isUuid, pageMetrics, QUESTIONS, resolveGuidePage, stepDoneByState, stripLocale, type GuidePage, type GuideStep, type QuestionKey } from "./pages";
import { countMetrics, onboardingState, type Counts } from "./state";
import { recommend, REC_METRICS } from "./recommendations";

export const GUIDE_KINDS = ["EXPLAIN", "GUIDE", "NEXT", "RECOMMEND", "ASK", "DO"] as const;
export type GuideKind = (typeof GUIDE_KINDS)[number];
const FALLBACK_PROFILE = "research_analyst";

type Scope = { organizationId: string; companyId: string };

async function authorize(ctx: RequestContext, organizationId: string, companyId: string): Promise<ScopeChain> {
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "companies.read", chain);
  return chain;
}

function userId(ctx: RequestContext): string {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("The guide is available to signed-in people only");
  return ctx.actor.id;
}

const effectiveProfile = (page: GuidePage) => (profileByKey(page.profile) ? page.profile : FALLBACK_PROFILE);

/** Record subject of a detail page, only when the record exists inside this company. */
const SUBJECT_LOOKUP: Record<string, (s: Scope, id: string) => Promise<unknown>> = {
  lead: (s, id) => db().lead.findFirst({ where: { ...s, id }, select: { id: true } }),
  crm_deal: (s, id) => db().crmDeal.findFirst({ where: { ...s, id }, select: { id: true } }),
  account: (s, id) => db().account.findFirst({ where: { ...s, id }, select: { id: true } }),
  ticket: (s, id) => db().supportTicket.findFirst({ where: { ...s, id }, select: { id: true } }),
  project: (s, id) => db().project.findFirst({ where: { ...s, id }, select: { id: true } }),
  hr_job: (s, id) => db().hrJob.findFirst({ where: { ...s, id }, select: { id: true } }),
  hr_candidate: (s, id) => db().hrCandidate.findFirst({ where: { ...s, id }, select: { id: true } }),
  workflow: (s, id) => db().workflow.findFirst({ where: { ...s, id }, select: { id: true } }),
};

async function recordSubject(scope: Scope, page: GuidePage, params: Record<string, string>): Promise<{ type: string; id: string } | null> {
  if (!page.subject) return null;
  const id = params[page.subject.param];
  const lookup = SUBJECT_LOOKUP[page.subject.type];
  if (!id || !isUuid(id) || !lookup) return null;
  return (await lookup(scope, id).catch(() => null)) ? { type: page.subject.type, id } : null;
}

const questionView = (key: QuestionKey) => {
  const q = QUESTIONS[key] as { type: "text" | "choice"; options?: readonly string[]; recommended?: string; optional?: boolean };
  return { key, type: q.type, options: q.options ? [...q.options] : [], recommended: q.recommended ?? null, optional: q.optional ?? false };
};

function stepView(step: GuideStep, counts: Counts, completed: Set<string>) {
  const auto = stepDoneByState(step, counts);
  return {
    key: step.key,
    href: step.href ?? null,
    selector: step.selector ?? null,
    auto,
    done: auto === true || completed.has(step.key),
    metric: step.done?.metric ?? null,
    ai: step.ai ? { questions: step.ai.questions.map(questionView) } : null,
  };
}

const requestSummary = {
  id: true,
  kind: true,
  pageKey: true,
  path: true,
  stepKey: true,
  question: true,
  profile: true,
  taskId: true,
  subjectType: true,
  subjectId: true,
  createdAt: true,
} as const;

/** Everything the guide panel shows for one page: registry context, real counts, progress, next steps, AI readiness. */
export async function guideContext(ctx: RequestContext, organizationId: string, companyId: string, rawPath: string) {
  const chain = await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  const scope = { organizationId, companyId };
  const resolved = resolveGuidePage(stripLocale(rawPath, LOCALES));
  const { page } = resolved;
  const [counts, onboarding, progress, canRun, recent] = await Promise.all([
    countMetrics(ctx, scope, chain, [...pageMetrics(page), ...REC_METRICS]),
    onboardingState(scope),
    db().guideProgress.findUnique({ where: { companyId_userId_pageKey: { companyId, userId: uid, pageKey: page.key } } }),
    can(ctx, "agents.run", chain),
    db().guideRequest.findMany({ where: { ...scope, userId: uid, pageKey: page.key }, orderBy: { createdAt: "desc" }, take: 5, select: requestSummary }),
  ]);
  const completed = new Set(progress?.completedSteps ?? []);
  const steps = page.steps.map((s) => stepView(s, counts, completed));
  const doneCount = steps.filter((s) => s.done).length;
  const firstOpen = steps.find((s) => !s.done) ?? null;
  const current = progress?.currentStep && steps.some((s) => s.key === progress.currentStep && !s.done) ? progress.currentStep : (firstOpen?.key ?? null);
  const statuses = await taskStatuses(scope, recent.map((r) => r.taskId).filter((v): v is string => !!v));
  return {
    page: {
      key: page.key,
      module: page.module,
      path: resolved.path,
      inherited: resolved.inherited,
      profile: effectiveProfile(page),
      tools: page.tools,
      metrics: page.metrics,
      next: page.next.map((href) => ({ href, pageKey: resolveGuidePage(href).page.key })),
      subjectType: page.subject?.type ?? null,
    },
    counts,
    steps,
    progress: { completed: [...completed], current, done: doneCount, total: steps.length, startedAt: progress?.createdAt ?? null },
    onboarding,
    recommendations: recommend(counts, onboarding, 3),
    ai: { configured: aiConfigured(), canRun },
    requests: recent.map((r) => ({ ...r, status: r.taskId ? (statuses.get(r.taskId) ?? null) : null })),
  };
}
export type GuideContext = Awaited<ReturnType<typeof guideContext>>;

async function taskStatuses(scope: Scope, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db().agentTask.findMany({ where: { ...scope, id: { in: ids } }, select: { id: true, status: true } });
  return new Map(rows.map((r) => [r.id, r.status as string]));
}

/** Company-wide "what should I do next" (top recommendations from real counts; onboarding first). */
export async function whatsNext(ctx: RequestContext, organizationId: string, companyId: string, limit = 3) {
  const chain = await authorize(ctx, organizationId, companyId);
  const scope = { organizationId, companyId };
  const [counts, onboarding] = await Promise.all([countMetrics(ctx, scope, chain, REC_METRICS), onboardingState(scope)]);
  return { recommendations: recommend(counts, onboarding, limit), onboarding };
}

export const progressInput = z.object({
  pageKey: z.string().max(60),
  stepKey: z.string().max(60).optional(),
  /** Mark `stepKey` done (true) or not done (false). */
  done: z.boolean().optional(),
  /** Remember `stepKey` as the resume point. */
  current: z.boolean().optional(),
  /** Start the page's steps over. */
  reset: z.boolean().optional(),
});

/** Save one person's progress through a page's guided steps (mark done / undo / resume point / reset). */
export async function saveProgress(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof progressInput>) {
  const input = progressInput.parse(raw);
  await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  const page = guidePageByKey(input.pageKey);
  if (!page) throw notFound("Guide page");
  if (input.stepKey && !page.steps.some((s) => s.key === input.stepKey)) throw invalid("Unknown step", { reason: "guide_unknown_step" });
  return transaction(async (tx) => {
    const key = { companyId_userId_pageKey: { companyId, userId: uid, pageKey: page.key } };
    const existing = await tx.guideProgress.findUnique({ where: key });
    let completed = new Set(existing?.completedSteps ?? []);
    let current = existing?.currentStep ?? null;
    if (input.reset) {
      completed = new Set();
      current = page.steps[0]?.key ?? null;
    }
    if (input.stepKey && input.done !== undefined) {
      if (input.done) completed.add(input.stepKey);
      else completed.delete(input.stepKey);
      if (input.done && current === input.stepKey) current = page.steps.find((s) => !completed.has(s.key))?.key ?? null;
    }
    if (input.stepKey && input.current) current = input.stepKey;
    const data = { completedSteps: page.steps.map((s) => s.key).filter((k) => completed.has(k)), currentStep: current };
    const row = existing
      ? await tx.guideProgress.update({ where: { id: existing.id }, data })
      : await tx.guideProgress.create({ data: { organizationId, companyId, userId: uid, pageKey: page.key, ...data } });
    return { pageKey: row.pageKey, completed: row.completedSteps, current: row.currentStep };
  });
}

export const guideRequestInput = z
  .object({
    kind: z.enum(GUIDE_KINDS),
    /** The browser pathname the request is made from (with or without locale). */
    path: z.string().max(400),
    locale: z.string().max(10).optional(),
    question: z.string().trim().max(2000).optional(),
    stepKey: z.string().max(60).optional(),
    answers: z.record(z.string().max(40), z.string().trim().max(1000)).optional(),
  })
  .refine((v) => (v.kind === "ASK" ? !!v.question : true), { path: ["question"], message: "Ask a question" })
  .refine((v) => (v.kind === "DO" ? !!v.stepKey || !!v.question : true), { path: ["question"], message: "Say what the AI should do" });

const KIND_TASK: Record<GuideKind, string> = {
  EXPLAIN:
    "Explain this page in plain language using the company's actual data: what it shows, what matters most right now, and the single most useful thing to do next.",
  GUIDE:
    "Give a short, numbered, step-by-step walkthrough for getting value from this page for this company, starting with the first unfinished guided step. For each step say exactly where to click or which page path to open.",
  NEXT:
    "Recommend the next three actions in priority order. For each: what to do, why (point to the real data), and the page path where it is done.",
  RECOMMEND:
    "Recommend the best option. Briefly compare the realistic options for this company and pick one, with the reason grounded in the data.",
  ASK: "Answer the person's question.",
  DO:
    "Do this for the person, using your tools. Any change you make is a proposal that waits in the approval queue until a person approves it: list exactly which approvals you requested. Never say something was created, changed or sent unless a tool result confirms it. If part of the job needs something you have no tool for, say what the person should do and on which page path.",
};

/** Plain-text brief for the AI: the page, the company's real state, the steps, and what is asked. */
async function buildInstructions(args: {
  kind: GuideKind;
  page: GuidePage;
  path: string;
  locale: AppLocale;
  counts: Counts;
  completed: Set<string>;
  subject: { type: string; id: string } | null;
  question?: string;
  step?: GuideStep;
  answers: Record<string, string>;
}) {
  const t = await getT(args.locale);
  const p = `guide.pages.${args.page.key}`;
  const facts = Object.entries(args.counts)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  const steps = args.page.steps
    .map((s, i) => {
      const done = stepDoneByState(s, args.counts) === true || args.completed.has(s.key);
      return `${i + 1}. ${t(`${p}.steps.${s.key}`)}${s.href ? ` (${s.href})` : ""} — ${done ? "done" : "not done yet"}`;
    })
    .join("\n");
  const next = args.page.next.map((h) => `${h} (${t(`guide.pages.${resolveGuidePage(h).page.key}.title`)})`).join(", ");
  const lines = [
    `The person is using the Realy.si app on the page "${t(`${p}.title`)}" (path ${args.path || "/"}).`,
    `About this page: ${t(`${p}.what`)} ${t(`${p}.why`)}`,
    `What they can do here: ${t(`${p}.can`)}`,
    facts ? `Company state right now (real record counts): ${facts}.` : "",
    `Guided steps on this page:\n${steps}`,
    `Read tools that fit this page: ${args.page.tools.join(", ")}. Look at the real data with your tools before answering.`,
    `Typical next pages: ${next}.`,
    args.subject ? `This page is about one record (${args.subject.type} ${args.subject.id}); read it with your tools first.` : "",
    "",
    `Task: ${KIND_TASK[args.kind]}`,
  ];
  if (args.step) lines.push(`What to do: ${t(`${p}.steps.${args.step.key}`)}.`);
  if (args.question) lines.push(args.kind === "DO" ? `The person's request: "${args.question}"` : `The person asks: "${args.question}"`);
  const answered = Object.entries(args.answers).filter(([, v]) => v);
  if (answered.length) {
    lines.push("Their answers:");
    for (const [k, v] of answered) {
      const q = QUESTIONS[k as QuestionKey] as { type: string } | undefined;
      const value = q?.type === "choice" && !/^\d+$/.test(v) ? t(`guide.questions.${k}.options.${v}`) : v;
      lines.push(`- ${t(`guide.questions.${k}.label`)} ${value}`);
    }
  }
  lines.push(
    "",
    `Write for someone with no business or technical background: short sentences, no jargon (explain any term you must use). Answer in ${LOCALE_NAMES[args.locale]}. Refer to app pages by their path (for example /crm/deals) so they become links. Never invent data: if the company's data does not answer it, say so. End with one line starting "Next step:" that recommends the single best next action and its page path.`,
  );
  return lines.filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n").slice(0, 7900);
}

function validateAnswers(step: GuideStep | undefined, answers: Record<string, string>) {
  if (!step) return {};
  const allowed = step.ai?.questions ?? [];
  const out: Record<string, string> = {};
  for (const key of allowed) {
    const q = QUESTIONS[key] as { type: "text" | "choice"; options?: readonly string[]; optional?: boolean };
    const v = (answers[key] ?? "").trim();
    if (!v) {
      if (!q.optional) throw invalid("Answer every question", { reason: "guide_answer_missing", question: key });
      continue;
    }
    if (q.type === "choice" && q.options && !q.options.includes(v)) throw invalid("Choose one of the options", { reason: "guide_answer_invalid", question: key });
    out[key] = v;
  }
  return out;
}

/**
 * Ask the guide's AI (explain / guide / next / recommend / free question) or have it do a step ("do this for me").
 * Creates a real AI task for the page's profile, linked to the page's record when there is one; the request row ties
 * the task to the person and page so the panel can show its progress, result and the approvals it created.
 */
export async function createGuideRequest(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof guideRequestInput>) {
  const input = guideRequestInput.parse(raw);
  const chain = await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  const scope = { organizationId, companyId };
  const path = stripLocale(input.path, LOCALES);
  const resolved = resolveGuidePage(path);
  const { page } = resolved;
  const step = input.stepKey ? page.steps.find((s) => s.key === input.stepKey) : undefined;
  if (input.stepKey && !step) throw invalid("Unknown step", { reason: "guide_unknown_step" });
  if (input.kind === "DO" && step && !step.ai) throw invalid("The AI can't do this step", { reason: "guide_step_not_automatable" });
  const answers = input.kind === "DO" ? validateAnswers(step, input.answers ?? {}) : {};
  const locale: AppLocale = isAppLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const [counts, progress, subject] = await Promise.all([
    countMetrics(ctx, scope, chain, pageMetrics(page)),
    db().guideProgress.findUnique({ where: { companyId_userId_pageKey: { companyId, userId: uid, pageKey: page.key } }, select: { completedSteps: true } }),
    recordSubject(scope, page, resolved.params),
  ]);
  const id = randomUUID();
  const profile = effectiveProfile(page);
  const instructions = await buildInstructions({
    kind: input.kind,
    page,
    path: resolved.path,
    locale,
    counts,
    completed: new Set(progress?.completedSteps ?? []),
    subject,
    question: input.question,
    step,
    answers,
  });
  const t = await getT(locale);
  const pageTitle = t(`guide.pages.${page.key}.title`);
  const title = (step && input.kind === "DO" ? t("guide.taskTitle.DO", { step: t(`guide.pages.${page.key}.steps.${step.key}`) }) : t(`guide.taskTitle.${input.kind}`, { page: pageTitle })).slice(0, 200);
  const task = await createTask(ctx, organizationId, companyId, {
    profile,
    title,
    instructions,
    subject: subject ?? { type: "guide_request", id },
  });
  const request = await transaction(async (tx) => {
    const row = await tx.guideRequest.create({
      data: {
        id,
        organizationId,
        companyId,
        userId: uid,
        kind: input.kind,
        pageKey: page.key,
        path: resolved.path,
        stepKey: step?.key ?? null,
        question: input.question ?? null,
        answers,
        profile,
        taskId: task.id,
        subjectType: subject?.type ?? "guide_request",
        subjectId: subject?.id ?? id,
      },
      select: requestSummary,
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "guide.request.created",
      resourceType: "guide_request",
      resourceId: id,
      newValue: { companyId, kind: input.kind, pageKey: page.key, stepKey: step?.key ?? null, taskId: task.id, profile },
    });
    return row;
  });
  return { ...request, status: task.status as string };
}

/** One of the viewer's guide requests with its AI task's live progress, result and the approvals it created. */
export async function getGuideRequest(ctx: RequestContext, organizationId: string, companyId: string, requestId: string) {
  await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  if (!isUuid(requestId)) throw notFound("Guide request");
  const scope = { organizationId, companyId };
  const request = await db().guideRequest.findFirst({ where: { ...scope, id: requestId, userId: uid }, select: requestSummary });
  if (!request) throw notFound("Guide request");
  const [task, approvals] = request.taskId
    ? await Promise.all([
        db().agentTask.findFirst({
          where: { ...scope, id: request.taskId },
          select: { id: true, title: true, status: true, output: true, toolCalls: true, errorCode: true, errorMessage: true, createdAt: true, startedAt: true, completedAt: true },
        }),
        db().approval.findMany({
          where: { ...scope, taskId: request.taskId },
          orderBy: { createdAt: "asc" },
          select: { id: true, tool: true, summary: true, status: true, risk: true, createdAt: true },
        }),
      ])
    : [null, []];
  const calls = Array.isArray(task?.toolCalls) ? (task.toolCalls as { tool?: unknown; error?: unknown }[]) : [];
  const last = calls[calls.length - 1];
  return {
    ...request,
    task: task
      ? {
          id: task.id,
          title: task.title,
          status: task.status as string,
          output: task.output,
          errorCode: task.errorCode,
          errorMessage: task.errorMessage,
          createdAt: task.createdAt,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          steps: calls.length,
          currentTool: typeof last?.tool === "string" ? last.tool : null,
          tools: calls.map((c) => ({ tool: typeof c.tool === "string" ? c.tool : "?", failed: !!c.error })).slice(-12),
        }
      : null,
    approvals,
  };
}
export type GuideRequestDetail = Awaited<ReturnType<typeof getGuideRequest>>;

/** The viewer's recent guide requests (optionally for one page). */
export async function listGuideRequests(ctx: RequestContext, organizationId: string, companyId: string, pageKey?: string) {
  await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  const scope = { organizationId, companyId };
  const rows = await db().guideRequest.findMany({
    where: { ...scope, userId: uid, ...(pageKey && guidePageByKey(pageKey) ? { pageKey } : {}) },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: requestSummary,
  });
  const statuses = await taskStatuses(scope, rows.map((r) => r.taskId).filter((v): v is string => !!v));
  return rows.map((r) => ({ ...r, status: r.taskId ? (statuses.get(r.taskId) ?? null) : null }));
}
