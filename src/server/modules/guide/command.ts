import "server-only";
import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden, isAppError, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask } from "@/server/modules/agents/service";
import { profileByKey } from "@/server/modules/agents/profiles";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";
import { DEFAULT_LOCALE, isAppLocale, LOCALE_NAMES, LOCALES, type AppLocale } from "@/i18n/config";
import { getT } from "@/i18n/server";
import { isUuid, resolveGuidePage, stripLocale } from "./pages";
import { countMetrics, onboardingState } from "./state";
import { recommend, REC_METRICS } from "./recommendations";

type Scope = { organizationId: string; companyId: string };

/**
 * Deterministic intent map for AI Command: words (in all five shipped languages) → the department's AI employee
 * profile. A command that matches several departments fans out to each; one that matches none goes to the AI CEO,
 * who decides and delegates (the AI fallback).
 */
export const COMMAND_INTENTS = [
  { key: "prospecting", profile: "sdr", words: ["customer", "prospect", "lead", "outreach", "cold email", "kunde", "interessent", "客户", "潜在", "线索", "ग्राहक", "लीड", "عملاء", "عميل", "زبائن"] },
  { key: "sales", profile: "account_executive", words: ["deal", "proposal", "pipeline", "close the", "quote", "angebot", "abschluss", "交易", "报价", "सौदा", "प्रस्ताव", "صفقة", "عرض سعر"] },
  { key: "marketing", profile: "cmo", words: ["marketing", "campaign", "brand", "advertis", "social media", "launch", "kampagne", "werbung", "营销", "推广", "活动", "विपणन", "अभियान", "تسويق", "حملة"] },
  { key: "content", profile: "content_writer", words: ["blog", "article", "newsletter", "copywrit", "linkedin post", "artikel", "文章", "博客", "लेख", "ब्लॉग", "مقال", "مدونة"] },
  { key: "seo", profile: "seo_specialist", words: ["seo", "keyword", "ranking", "suchmaschine", "搜索引擎", "कीवर्ड", "الكلمات المفتاحية"] },
  { key: "product", profile: "product_manager", words: ["product", "feature", "roadmap", "prd", "specification", "produkt", "funktion", "产品", "功能", "उत्पाद", "फ़ीचर", "منتج", "ميزة"] },
  { key: "finance", profile: "ai_cfo", words: ["financ", "invoice", "cash", "budget", "revenue", "expense", "profit", "p&l", "forecast", "finanz", "rechnung", "umsatz", "财务", "发票", "预算", "收入", "वित्त", "चालान", "बजट", "مالي", "فاتورة", "ميزانية", "إيرادات"] },
  { key: "recruiting", profile: "recruiter", words: ["hire", "hiring", "recruit", "job post", "candidate", "vacancy", "einstell", "stelle", "bewerber", "招聘", "候选人", "भर्ती", "उम्मीदवार", "توظيف", "مرشح", "وظيفة"] },
  { key: "people", profile: "people_analyst", words: ["employee", "headcount", "payroll", "leave", "onboard", "mitarbeiter", "员工", "कर्मचारी", "موظف"] },
  { key: "support", profile: "support_lead", words: ["support", "ticket", "complaint", "helpdesk", "help desk", "kundendienst", "客服", "工单", "सहायता", "टिकट", "دعم", "تذكرة"] },
  { key: "projects", profile: "ai_project_manager", words: ["project", "sprint", "milestone", "deadline", "task list", "projekt", "项目", "里程碑", "परियोजना", "مشروع"] },
  { key: "automation", profile: "automation_architect", words: ["automat", "workflow", "zap", "自动", "工作流", "स्वचालित", "वर्कफ़्लो", "أتمتة", "سير العمل"] },
  { key: "analytics", profile: "bi_analyst", words: ["kpi", "metric", "analytics", "dashboard", "trend", "kennzahl", "指标", "仪表板", "मीट्रिक", "مؤشر", "لوحة"] },
  { key: "operations", profile: "operations_assistant", words: ["process", "checklist", "sop", "vendor", "supplier", "prozess", "lieferant", "流程", "供应商", "प्रक्रिया", "आपूर्तिकर्ता", "عملية", "مورد"] },
  { key: "knowledge", profile: "brain_answerer", words: ["document", "policy", "knowledge", "dokument", "richtlinie", "文档", "政策", "दस्तावेज़", "नीति", "وثيقة", "سياسة"] },
] as const;
const FALLBACK = { key: "fallback", profile: "ai_ceo" } as const;
const MAX_FANOUT = 3;

export interface RoutedIntent {
  key: string;
  profile: string;
  score: number;
}

/** Route a command to up to three department profiles (most matched words first); none → the AI CEO fallback. */
export function routeCommand(text: string): RoutedIntent[] {
  const lower = ` ${text.toLowerCase()} `;
  const hits = COMMAND_INTENTS.map((i) => ({ key: i.key, profile: i.profile, score: i.words.filter((w) => lower.includes(w)).length }))
    .filter((i) => i.score > 0 && profileByKey(i.profile))
    .sort((a, b) => b.score - a.score);
  // One department per profile family: "content" and "seo" fold into "marketing" when both match.
  const picked: RoutedIntent[] = [];
  for (const h of hits) {
    if ((h.key === "content" || h.key === "seo") && picked.some((p) => p.key === "marketing")) continue;
    if (h.key === "marketing" && picked.some((p) => p.key === "content" || p.key === "seo")) {
      const i = picked.findIndex((p) => p.key === "content" || p.key === "seo");
      picked[i] = h;
      continue;
    }
    if (!picked.some((p) => p.profile === h.profile)) picked.push(h);
  }
  if (picked.length) return picked.slice(0, MAX_FANOUT);
  const fb = profileByKey(FALLBACK.profile) ? FALLBACK.profile : "research_analyst";
  return [{ key: FALLBACK.key, profile: fb, score: 0 }];
}

async function authorize(ctx: RequestContext, organizationId: string, companyId: string): Promise<ScopeChain> {
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "companies.read", chain);
  return chain;
}

function userId(ctx: RequestContext): string {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("AI Command is available to signed-in people only");
  return ctx.actor.id;
}

export const commandInput = z.object({
  text: z.string().trim().min(2).max(2000),
  sessionId: z.string().uuid().optional(),
  locale: z.string().max(10).optional(),
  /** Browser path the command was given from (page context), when sent from the guide panel. */
  path: z.string().max(400).optional(),
});

/** The company's hired AI employee for a role (active, oldest first), preferred over the bare profile. */
async function hiredEmployee(scope: Scope, profile: string) {
  return db().aiEmployee.findFirst({
    where: { ...scope, profileKey: profile, status: "ACTIVE", archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
}

function reasonOf(err: unknown): string {
  if (isAppError(err)) {
    const r = err.details?.reason;
    return typeof r === "string" ? r : err.code;
  }
  return "internal_error";
}

async function instructionsFor(args: {
  text: string;
  intent: RoutedIntent;
  team: RoutedIntent[];
  locale: AppLocale;
  facts: string;
  pageLine: string;
}) {
  const t = await getT(args.locale);
  const others = args.team.filter((x) => x.profile !== args.intent.profile).map((x) => t(`profiles.${x.profile}.name`));
  return [
    `The founder gave this command in Realy.si's AI Command workspace: "${args.text}"`,
    args.intent.key === "fallback"
      ? "No single department clearly owns this command. Decide what it needs. If the company has AI employees for the departments involved (read_ai_employees), delegate their parts with delegate_to_ai_employee and summarize; otherwise do what you can yourself and say which department should do the rest."
      : `You handle the ${args.intent.key} part of it as the company's ${t(`profiles.${args.intent.profile}.name`)}.`,
    others.length ? `Other AI employees work on the other parts in parallel: ${others.join(", ")}. Stay within your part.` : "",
    args.facts ? `Company state right now (real record counts): ${args.facts}.` : "",
    args.pageLine,
    "",
    "Work through your tools and the company's real data. Anything that changes data or contacts the outside world is a proposal that waits for a person's approval: list exactly which approvals you requested. Never say something was created, changed or sent unless a tool result confirms it, and never invent customers, numbers or results — if the data is missing, say what is needed.",
    `Write the result in ${LOCALE_NAMES[args.locale]} as concise Markdown (short headings, bullet lists, bold for key numbers) for someone with no business background. Refer to app pages by their path (for example /crm or /approvals) so they become links. End with one line starting "Next step:".`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 7900);
}

/**
 * Run one command: route it, create a real agent task per department (preferring the company's hired AI employee for
 * that role), and record the conversation. Task-creation failures (AI not configured, budget, permission) are kept on
 * the assistant message so the workspace shows why — nothing is reported as running that is not.
 */
export async function runCommand(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof commandInput>) {
  const input = commandInput.parse(raw);
  const chain = await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  const scope = { organizationId, companyId };
  const locale: AppLocale = isAppLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  let session = input.sessionId
    ? await db().commandSession.findFirst({ where: { ...scope, id: input.sessionId, userId: uid }, select: { id: true } })
    : null;
  if (input.sessionId && !session) throw notFound("Command session");

  const team = routeCommand(input.text);
  const counts = await countMetrics(ctx, scope, chain, REC_METRICS);
  const facts = Object.entries(counts)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  let pageLine = "";
  if (input.path) {
    const resolved = resolveGuidePage(stripLocale(input.path, LOCALES));
    const t = await getT(locale);
    pageLine = `They gave it from the page "${t(`guide.pages.${resolved.page.key}.title`)}" (${resolved.path || "/"}).`;
  }

  session = await transaction(async (tx) => {
    const s = session
      ? await tx.commandSession.update({ where: { id: session.id }, data: { updatedAt: new Date() }, select: { id: true } })
      : await tx.commandSession.create({ data: { ...scope, userId: uid, title: input.text.slice(0, 120) }, select: { id: true } });
    await tx.commandMessage.create({ data: { ...scope, sessionId: s.id, role: "USER", content: input.text } });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "guide.command.created",
      resourceType: "command_session",
      resourceId: s.id,
      newValue: { companyId, intents: team.map((i) => i.key) },
    });
    return s;
  });

  const t = await getT(locale);
  for (const intent of team) {
    const instructions = await instructionsFor({ text: input.text, intent, team, locale, facts, pageLine });
    const title = t("guide.command.taskTitle", { command: input.text.slice(0, 150) }).slice(0, 200);
    const employee = await hiredEmployee(scope, intent.profile);
    let taskId: string | null = null;
    let usedEmployee: string | null = null;
    let errorReason: string | null = null;
    const base = { title, instructions, subject: { type: "command_session", id: session.id } };
    try {
      if (employee) {
        try {
          taskId = (await createTask(ctx, organizationId, companyId, { ...base, aiEmployeeId: employee.id })).id;
          usedEmployee = employee.id;
        } catch (err) {
          // A paused or over-budget employee: the role itself still does the work.
          if (!reasonOf(err).startsWith("workforce_employee")) throw err;
        }
      }
      if (!taskId) taskId = (await createTask(ctx, organizationId, companyId, { ...base, profile: intent.profile })).id;
    } catch (err) {
      errorReason = reasonOf(err);
    }
    await db().commandMessage.create({
      data: { ...scope, sessionId: session.id, role: "ASSISTANT", content: intent.key, intent: intent.key, profile: intent.profile, aiEmployeeId: usedEmployee, taskId, errorReason },
    });
  }
  return getCommandSession(ctx, organizationId, companyId, session.id);
}

/** A command conversation with live task state: status, trace, delegated child tasks and approvals. */
export async function getCommandSession(ctx: RequestContext, organizationId: string, companyId: string, sessionId: string) {
  const chain = await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  if (!isUuid(sessionId)) throw notFound("Command session");
  const scope = { organizationId, companyId };
  const session = await db().commandSession.findFirst({
    where: { ...scope, id: sessionId, userId: uid },
    select: { id: true, title: true, createdAt: true, updatedAt: true, messages: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
  if (!session) throw notFound("Command session");
  const taskIds = session.messages.map((m) => m.taskId).filter((v): v is string => !!v);
  const taskSelect = {
    id: true,
    title: true,
    profile: true,
    status: true,
    output: true,
    toolCalls: true,
    errorCode: true,
    errorMessage: true,
    aiEmployeeId: true,
    parentTaskId: true,
    createdAt: true,
    startedAt: true,
    completedAt: true,
  } as const;
  const tasks = taskIds.length ? await db().agentTask.findMany({ where: { ...scope, id: { in: taskIds } }, select: taskSelect }) : [];
  const children = taskIds.length ? await db().agentTask.findMany({ where: { ...scope, parentTaskId: { in: taskIds } }, select: taskSelect, orderBy: { createdAt: "asc" } }) : [];
  const allIds = [...taskIds, ...children.map((c) => c.id)];
  const [approvals, canDecide] = await Promise.all([
    allIds.length
      ? db().approval.findMany({ where: { ...scope, taskId: { in: allIds } }, orderBy: { createdAt: "asc" }, select: { id: true, taskId: true, tool: true, summary: true, status: true, risk: true, error: true, createdAt: true } })
      : [],
    can(ctx, "approvals.decide", chain),
  ]);
  const employeeIds = [...new Set([...tasks, ...children].map((x) => x.aiEmployeeId).filter((v): v is string => !!v))];
  const employees = employeeIds.length ? await db().aiEmployee.findMany({ where: { ...scope, id: { in: employeeIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(employees.map((e) => [e.id, e.name]));
  const view = (task: (typeof tasks)[number]) => {
    const calls = Array.isArray(task.toolCalls) ? (task.toolCalls as { tool?: unknown; error?: unknown }[]) : [];
    return {
      id: task.id,
      title: task.title,
      profile: task.profile,
      employeeName: task.aiEmployeeId ? (nameOf.get(task.aiEmployeeId) ?? null) : null,
      status: task.status as string,
      output: task.output,
      errorCode: task.errorCode,
      errorMessage: task.errorMessage,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      trace: calls.map((c) => ({ tool: typeof c.tool === "string" ? c.tool : "unknown", failed: !!c.error })),
      approvals: approvals.filter((a) => a.taskId === task.id),
    };
  };
  const byId = new Map(tasks.map((x) => [x.id, x]));
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    canDecide,
    messages: session.messages.map((m) => {
      const task = m.taskId ? byId.get(m.taskId) : undefined;
      return {
        id: m.id,
        role: m.role as "USER" | "ASSISTANT",
        content: m.content,
        intent: m.intent,
        profile: m.profile,
        errorReason: m.errorReason,
        createdAt: m.createdAt,
        task: task ? view(task) : null,
        children: task ? children.filter((c) => c.parentTaskId === task.id).map(view) : [],
      };
    }),
  };
}
export type CommandSessionView = Awaited<ReturnType<typeof getCommandSession>>;

/** The viewer's command history (newest first). */
export async function listCommandSessions(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  return db().commandSession.findMany({
    where: { organizationId, companyId, userId: uid },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
  });
}

export async function deleteCommandSession(ctx: RequestContext, organizationId: string, companyId: string, sessionId: string) {
  await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  if (!isUuid(sessionId)) throw notFound("Command session");
  return transaction(async (tx) => {
    const s = await tx.commandSession.findFirst({ where: { organizationId, companyId, id: sessionId, userId: uid }, select: { id: true } });
    if (!s) throw notFound("Command session");
    await tx.commandSession.delete({ where: { id: s.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "guide.command.deleted", resourceType: "command_session", resourceId: s.id });
    return { ok: true };
  });
}

/** Suggested commands from the company's real state (keys of guide.command.suggest.*) plus AI readiness. */
export async function commandSuggestions(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await authorize(ctx, organizationId, companyId);
  const scope = { organizationId, companyId };
  const [counts, onboarding, canRun] = await Promise.all([countMetrics(ctx, scope, chain, REC_METRICS), onboardingState(scope), can(ctx, "agents.run", chain)]);
  const fromState = recommend(counts, onboarding, 4).map((r) => r.key);
  const base = ["customers", "campaign", "product", "financeReport"];
  return { suggestions: [...new Set([...fromState, ...base])].slice(0, 6), ai: { configured: aiConfigured(), canRun } };
}
