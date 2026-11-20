import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { can } from "@/server/modules/rbac/service";
import { createCampaign } from "@/server/modules/marketing/campaigns";
import { createArticle } from "@/server/modules/support/kb";
import { createEmployee } from "@/server/modules/workforce/service";
import { setSprintTasks } from "./agile";
import { productOf, PRODUCT_STAGES, stageIndex } from "./product-core";
import { createWorkTask, PRIORITIES } from "./tasks";
import { authorize, isUuid, PAGE_SIZE, pageParam, param } from "./shared";

/** Product delivery: backlog → sprints in the development project, feedback aggregation, analytics, launch connections. */

export const backlogTasksInput = z.object({
  featureId: z.string().uuid().nullable().optional(),
  sprintId: z.string().uuid().nullable().optional(),
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        description: z.string().trim().max(20_000).optional(),
        priority: z.enum(PRIORITIES).default("MEDIUM"),
        estimatePoints: z.number().int().min(0).max(100).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
});
export const pushToSprintInput = z.object({ featureId: z.string().uuid(), sprintId: z.string().uuid() });

/** Profiles of the AI product team (for hiring and the workspace). */
export const PRODUCT_TEAM_PROFILES = ["product_manager", "product_researcher", "business_analyst", "ux_designer", "ui_designer", "software_architect", "frontend_developer", "backend_developer", "ai_engineer", "qa_agent", "release_manager"];
/** Default names of hired AI product team members (English; people can rename them in the AI Workforce). */
const TEAM_NAMES: Record<string, string> = {
  product_manager: "AI Product Manager",
  product_researcher: "AI Product Researcher",
  business_analyst: "AI Business Analyst",
  ux_designer: "AI UX Designer",
  ui_designer: "AI UI Designer",
  software_architect: "AI Software Architect",
  frontend_developer: "AI Frontend Developer",
  backend_developer: "AI Backend Developer",
  ai_engineer: "AI Engineer",
  qa_agent: "AI QA Engineer",
  release_manager: "AI Release Manager",
};
export const hireTeamInput = z.object({ profiles: z.array(z.enum(PRODUCT_TEAM_PROFILES as [string, ...string[]])).min(1).max(11) });

const DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

async function devProject(organizationId: string, companyId: string, productId: string) {
  const p = await productOf(db(), organizationId, companyId, productId);
  if (!p.developmentProjectId) throw conflict("Link or create the product's development project first", { reason: "work_product_no_project" });
  return { product: p, projectId: p.developmentProjectId };
}

async function checkFeature(organizationId: string, companyId: string, productId: string, featureId: string | null | undefined) {
  if (!featureId) return null;
  const f = await db().productFeature.findFirst({ where: { id: featureId, organizationId, companyId, productId }, select: { id: true, title: true } });
  if (!f) throw notFound("Feature");
  return f;
}

/** Backlog view: product features with their tasks, unplanned tasks and open sprints of the development project. */
export async function getBacklog(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const p = await productOf(db(), organizationId, companyId, productId);
  const features = await db().productFeature.findMany({
    where: { productId, companyId, archivedAt: null, status: { not: "CANCELLED" } },
    orderBy: [{ riceScore: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
    take: 300,
    select: {
      id: true,
      title: true,
      status: true,
      riceScore: true,
      tasks: { where: { archivedAt: null }, orderBy: { createdAt: "asc" }, take: 100, select: { id: true, title: true, status: true, estimatePoints: true, sprintId: true, projectId: true, assignee: { select: { name: true } } } },
    },
  });
  if (!p.developmentProjectId) return { projectId: null, features, unlinked: [], sprints: [] };
  const [unlinked, sprints] = await Promise.all([
    db().workTask.findMany({
      where: { companyId, projectId: p.developmentProjectId, archivedAt: null, featureId: null, parentId: null, status: { notIn: ["DONE", "CANCELLED"] } },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, title: true, status: true, estimatePoints: true, sprintId: true, assignee: { select: { name: true } } },
    }),
    db().sprint.findMany({ where: { companyId, projectId: p.developmentProjectId, status: { not: "COMPLETED" } }, orderBy: { startDate: "asc" }, select: { id: true, name: true, status: true, startDate: true, endDate: true } }),
  ]);
  return { projectId: p.developmentProjectId, features, unlinked, sprints };
}

/** Create backlog tasks in the product's development project (optionally for a feature and/or into a sprint). */
export async function createBacklogTasks(ctx: RequestContext, organizationId: string, companyId: string, productId: string, raw: z.input<typeof backlogTasksInput>) {
  const input = backlogTasksInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "projects.manage");
  const { projectId } = await devProject(organizationId, companyId, productId);
  await checkFeature(organizationId, companyId, productId, input.featureId);
  if (input.sprintId && !(await db().sprint.findFirst({ where: { id: input.sprintId, companyId, projectId, status: { not: "COMPLETED" } }, select: { id: true } }))) throw notFound("Sprint");
  const created = [];
  for (const t of input.tasks) {
    created.push(
      await createWorkTask(ctx, organizationId, companyId, {
        projectId,
        title: t.title,
        description: t.description,
        priority: t.priority,
        estimatePoints: t.estimatePoints ?? null,
        status: input.sprintId ? "TODO" : "BACKLOG",
        featureId: input.featureId ?? null,
        sprintId: input.sprintId ?? null,
      }),
    );
  }
  return { created: created.map((t) => ({ id: t.id, title: t.title })) };
}

/** Push a feature to a sprint: its open, unplanned tasks join the sprint (a first task is created from the feature when it has none). */
export async function pushFeatureToSprint(ctx: RequestContext, organizationId: string, companyId: string, productId: string, raw: z.input<typeof pushToSprintInput>) {
  const input = pushToSprintInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "projects.manage");
  const { projectId } = await devProject(organizationId, companyId, productId);
  const feature = (await checkFeature(organizationId, companyId, productId, input.featureId))!;
  const tasks = await db().workTask.findMany({ where: { companyId, projectId, featureId: feature.id, archivedAt: null, sprintId: null, status: { notIn: ["DONE", "CANCELLED"] } }, select: { id: true } });
  if (!tasks.length) {
    const t = await createWorkTask(ctx, organizationId, companyId, { projectId, title: feature.title, status: "TODO", featureId: feature.id, sprintId: input.sprintId });
    await db().productFeature.updateMany({ where: { id: feature.id, companyId, status: { in: ["PROPOSED", "PLANNED"] } }, data: { status: "IN_PROGRESS", projectId } });
    return { added: 1, created: t.id };
  }
  const r = await setSprintTasks(ctx, organizationId, companyId, input.sprintId, { add: tasks.map((t) => t.id) });
  await db().productFeature.updateMany({ where: { id: feature.id, companyId, status: { in: ["PROPOSED", "PLANNED"] } }, data: { status: "IN_PROGRESS", projectId } });
  return { added: r.added };
}

// ─── Feedback aggregation ───

const OPEN_TICKET = ["NEW", "OPEN", "PENDING", "ON_HOLD"] as const;

/**
 * Feedback for a product: product feedback rows, plus (read-only, when the viewer may see them) support tickets that
 * mention the product and the CRM accounts behind them.
 */
export async function productFeedback(ctx: RequestContext, organizationId: string, companyId: string, productId: string, raw: Record<string, string | string[] | undefined>) {
  const chain = await authorize(ctx, organizationId, companyId, "projects.read");
  const p = await productOf(db(), organizationId, companyId, productId);
  const page = pageParam(raw);
  const q = param(raw, "q")?.slice(0, 200);
  const where: Prisma.ProductFeedbackWhereInput = { organizationId, companyId, productId, archivedAt: null, ...(q ? { body: { contains: q, mode: "insensitive" } } : {}) };
  const [canSupport, canSales] = await Promise.all([can(ctx, "support.read", chain), can(ctx, "sales.read", chain)]);
  const mention: Prisma.SupportTicketWhereInput = {
    organizationId,
    companyId,
    OR: [{ subject: { contains: p.name, mode: "insensitive" } }, { description: { contains: p.name, mode: "insensitive" } }, { tags: { has: p.name.toLowerCase() } }],
  };
  const [total, rows, tickets, ticketCount, openTickets] = await Promise.all([
    db().productFeedback.count({ where }),
    db().productFeedback.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { feature: { select: { id: true, title: true } } } }),
    canSupport ? db().supportTicket.findMany({ where: mention, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, number: true, subject: true, status: true, priority: true, createdAt: true, accountId: true } }) : [],
    canSupport ? db().supportTicket.count({ where: mention }) : 0,
    canSupport ? db().supportTicket.count({ where: { ...mention, status: { in: [...OPEN_TICKET] } } }) : 0,
  ]);
  const accountIds = [...new Set([...rows.map((r) => r.accountId), ...tickets.map((t) => t.accountId)].filter((v): v is string => !!v))];
  const accounts = accountIds.length ? await db().account.findMany({ where: { id: { in: accountIds }, companyId }, select: { id: true, name: true } }) : [];
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const feedbackAccounts = await db().productFeedback.groupBy({ by: ["accountId"], where: { organizationId, companyId, productId, archivedAt: null, accountId: { not: null } }, _count: { _all: true } });
  const topIds = feedbackAccounts.map((a) => a.accountId!).filter((id) => !acc.has(id));
  const more = canSales && topIds.length ? await db().account.findMany({ where: { id: { in: topIds }, companyId }, select: { id: true, name: true } }) : [];
  for (const a of more) acc.set(a.id, a.name);
  return {
    data: rows.map((r) => ({ ...r, accountName: r.accountId ? (acc.get(r.accountId) ?? null) : null })),
    total,
    page,
    pageSize: PAGE_SIZE,
    support: canSupport ? { tickets: tickets.map((t) => ({ ...t, accountName: t.accountId ? (acc.get(t.accountId) ?? null) : null })), total: ticketCount, open: openTickets } : null,
    accounts: canSales
      ? feedbackAccounts
          .map((a) => ({ id: a.accountId!, name: acc.get(a.accountId!) ?? null, feedback: a._count._all, tickets: tickets.filter((t) => t.accountId === a.accountId).length }))
          .concat(
            [...new Set(tickets.map((t) => t.accountId).filter((v): v is string => !!v && !feedbackAccounts.some((f) => f.accountId === v)))].map((id) => ({ id, name: acc.get(id) ?? null, feedback: 0, tickets: tickets.filter((t) => t.accountId === id).length })),
          )
          .sort((a, b) => b.feedback + b.tickets - (a.feedback + a.tickets))
          .slice(0, 20)
      : null,
  };
}

// ─── Analytics ───

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** Product analytics from real rows: features shipped, cycle time per stage, feedback volume/sentiment, release cadence. */
export async function productAnalytics(ctx: RequestContext, organizationId: string, companyId: string, productId: string, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  const p = await productOf(db(), organizationId, companyId, productId);
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const [featureStatus, shippedRows, history, feedbackRows, sentiment, releases, taskStats] = await Promise.all([
    db().productFeature.groupBy({ by: ["status"], where: { productId, companyId, archivedAt: null }, _count: { _all: true } }),
    db().productFeature.findMany({ where: { productId, companyId, archivedAt: null, status: "SHIPPED" }, select: { updatedAt: true, release: { select: { releaseDate: true } } } }),
    db().productStageChange.findMany({ where: { productId, companyId }, orderBy: { enteredAt: "asc" }, select: { stage: true, enteredAt: true, exitedAt: true } }),
    db().productFeedback.findMany({ where: { productId, companyId, archivedAt: null, createdAt: { gte: since } }, select: { createdAt: true } }),
    db().productFeedback.groupBy({ by: ["sentiment"], where: { productId, companyId, archivedAt: null }, _count: { _all: true } }),
    db().productRelease.findMany({ where: { productId, companyId, status: "RELEASED" }, select: { version: true, releaseDate: true, publishedAt: true, updatedAt: true }, take: 200 }),
    p.developmentProjectId
      ? db().workTask.groupBy({ by: ["status"], where: { companyId, projectId: p.developmentProjectId, archivedAt: null }, _count: { _all: true } })
      : Promise.resolve([] as { status: string; _count: { _all: number } }[]),
  ]);
  const months: string[] = [];
  for (let i = 0; i < 6; i++) months.push(monthKey(new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1))));
  const shippedAt = (r: (typeof shippedRows)[number]) => r.release?.releaseDate ?? r.updatedAt;
  const stages = PRODUCT_STAGES.map((stage) => {
    const stays = history.filter((h) => h.stage === stage);
    const days = stays.reduce((s, h) => s + ((h.exitedAt ?? now).getTime() - h.enteredAt.getTime()) / DAY, 0);
    return { stage, days: stays.length ? round1(days) : null, current: p.stage === stage, visits: stays.length };
  });
  const dates = releases.map((r) => r.releaseDate ?? r.publishedAt ?? r.updatedAt).sort((a, b) => a.getTime() - b.getTime());
  const gaps = dates.slice(1).map((d, i) => (d.getTime() - dates[i]!.getTime()) / DAY);
  const totalFeatures = featureStatus.reduce((s, x) => s + x._count._all, 0);
  return {
    features: {
      total: totalFeatures,
      byStatus: Object.fromEntries(featureStatus.map((x) => [x.status, x._count._all])) as Record<string, number>,
      shipped: shippedRows.length,
      shippedByMonth: months.map((m) => ({ month: m, count: shippedRows.filter((r) => monthKey(shippedAt(r)) === m).length })),
    },
    stages,
    daysInLifecycle: history.length ? round1((now.getTime() - history[0]!.enteredAt.getTime()) / DAY) : 0,
    progress: Math.round(((stageIndex(p.stage) + 1) / PRODUCT_STAGES.length) * 100),
    feedback: {
      byMonth: months.map((m) => ({ month: m, count: feedbackRows.filter((r) => monthKey(r.createdAt) === m).length })),
      sentiment: { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0, UNRATED: 0, ...Object.fromEntries(sentiment.map((s) => [s.sentiment ?? "UNRATED", s._count._all])) } as Record<"POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNRATED", number>,
    },
    releases: { count: dates.length, last: dates.at(-1) ?? null, avgDaysBetween: gaps.length ? round1(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null },
    tasks: Object.fromEntries(taskStats.map((x) => [x.status, x._count._all])) as Record<string, number>,
  };
}

// ─── Connections ───

/** Draft the launch campaign in Marketing (marketing.manage applies) and link it to the product. */
export async function createLaunchCampaign(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  await authorize(ctx, organizationId, companyId, "projects.manage");
  const p = await productOf(db(), organizationId, companyId, productId);
  if (p.launchCampaignId && (await db().marketingCampaign.findFirst({ where: { id: p.launchCampaignId, companyId }, select: { id: true } }))) {
    throw conflict("The launch campaign exists", { reason: "work_product_campaign_exists" });
  }
  const release = await db().productRelease.findFirst({ where: { productId, companyId }, orderBy: { releaseDate: { sort: "desc", nulls: "last" } }, select: { version: true, releaseDate: true } });
  const c = await createCampaign(ctx, organizationId, companyId, {
    name: `${p.name} launch`.slice(0, 200),
    description: [p.description, p.targetUsers ? `Target users: ${p.targetUsers}` : null, release ? `Release ${release.version}` : null].filter(Boolean).join("\n\n").slice(0, 5000) || undefined,
    objective: `Launch ${p.name}`.slice(0, 500),
    startDate: release?.releaseDate ? release.releaseDate.toISOString().slice(0, 10) : undefined,
  });
  await transaction(async (tx) => {
    await tx.product.update({ where: { id: productId }, data: { launchCampaignId: c.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "product.campaign_linked", resourceType: "product", resourceId: productId, newValue: { campaignId: c.id } });
  });
  return { id: c.id, name: c.name };
}

/** Draft a support knowledge-base article for a release (support.manage applies). */
export async function createReleaseKbDraft(ctx: RequestContext, organizationId: string, companyId: string, releaseId: string) {
  await authorize(ctx, organizationId, companyId, "projects.read");
  if (!isUuid(releaseId)) throw notFound("Release");
  const r = await db().productRelease.findFirst({
    where: { id: releaseId, organizationId, companyId },
    include: { product: { select: { name: true } }, features: { where: { archivedAt: null, status: { not: "CANCELLED" } }, select: { title: true, spec: true, acceptanceCriteria: true }, orderBy: { title: "asc" }, take: 100 } },
  });
  if (!r) throw notFound("Release");
  const name = r.product ? `${r.product.name} ${r.version}` : r.version;
  const body = [
    `# What's new in ${name}${r.name ? ` — ${r.name}` : ""}`,
    r.notes,
    r.features.length ? `## Changes\n${r.features.map((f) => `### ${f.title}\n${f.spec ? f.spec.split("\n").slice(0, 6).join("\n") : ""}`.trim()).join("\n\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const a = await createArticle(ctx, organizationId, companyId, { title: `What's new in ${name}`.slice(0, 200), body: body.slice(0, 100_000), status: "DRAFT", tags: ["release", ...(r.product ? [r.product.name.toLowerCase().slice(0, 40)] : [])] });
  return { id: a.id, title: a.title };
}

/** Records linked to a product in other areas (overview). */
export async function productConnections(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "projects.read");
  const p = await productOf(db(), organizationId, companyId, productId);
  const [canMarketing, canAgents] = await Promise.all([can(ctx, "marketing.read", chain), can(ctx, "agents.read", chain)]);
  const [campaign, aiTasks, aiTeam] = await Promise.all([
    canMarketing && p.launchCampaignId ? db().marketingCampaign.findFirst({ where: { id: p.launchCampaignId, companyId }, select: { id: true, name: true, status: true } }) : null,
    canAgents ? db().agentTask.count({ where: { organizationId, companyId, OR: [{ subjectId: productId }, { subjectType: "product_plan", subjectId: { in: (await db().productPlanRun.findMany({ where: { productId, companyId }, select: { id: true } })).map((r) => r.id) } }] } }) : 0,
    canAgents ? db().aiEmployee.findMany({ where: { organizationId, companyId, archivedAt: null, profileKey: { in: PRODUCT_TEAM_PROFILES } }, select: { id: true, name: true, profileKey: true, status: true }, orderBy: { name: "asc" } }) : [],
  ]);
  return { campaign, aiTasks, aiTeam, canMarketing, canAgents };
}

/** Hire the AI product team: one AI employee per chosen profile the company does not have yet (agents.manage applies). */
export async function hireProductTeam(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof hireTeamInput>) {
  const input = hireTeamInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "projects.read");
  const existing = await db().aiEmployee.findMany({ where: { organizationId, companyId, archivedAt: null, profileKey: { in: input.profiles } }, select: { profileKey: true } });
  const have = new Set(existing.map((e) => e.profileKey));
  const hired = [];
  for (const key of input.profiles) {
    if (have.has(key)) continue;
    const e = await createEmployee(ctx, organizationId, companyId, { profileKey: key, name: TEAM_NAMES[key] ?? key });
    hired.push({ id: e.id, name: e.name, profileKey: key });
  }
  return { hired, skipped: input.profiles.length - hired.length };
}
