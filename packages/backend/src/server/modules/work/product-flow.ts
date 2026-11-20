import type { ProductDocKind, ProductStage } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { can } from "@/server/modules/rbac/service";
import { createSprint, setSprintTasks, startSprint } from "./agile";
import { productOf, stageIndex } from "./product-core";
import { docSubject } from "./product-docs";
import { createRelease, updateRelease } from "./product";
import { addDays, authorize, dayString, today } from "./shared";

/**
 * "Build a product with AI" — one guided flow over the Product Studio: idea → research & validation → PRD →
 * architecture → design brief → backlog (real work tasks in the development project) → first sprint → release notes →
 * launch brief handed to Marketing (the launch campaign). Every stage's state is read from real records: saved product
 * documents (the lifecycle's doc kinds, which the stage gates check), AI drafting tasks, the backlog, the sprint, the
 * release and the linked campaign. The flow's own actions only compose existing services.
 */

export const FLOW = [
  { key: "idea", docs: ["IDEA_BRIEF"], stages: ["IDEA"] },
  { key: "research", docs: ["RESEARCH", "VALIDATION_REPORT"], stages: ["RESEARCH", "VALIDATION"] },
  { key: "prd", docs: ["PRD"], stages: ["BUSINESS_REQUIREMENTS", "PRODUCT_REQUIREMENTS"] },
  { key: "architecture", docs: ["ARCHITECTURE"], stages: ["ARCHITECTURE"] },
  { key: "design", docs: ["DESIGN_BRIEF"], stages: ["DESIGN"] },
  { key: "backlog", docs: [], stages: ["DEVELOPMENT"] },
  { key: "sprint", docs: [], stages: ["DEVELOPMENT", "QA"] },
  { key: "release", docs: [], stages: ["RELEASE"] },
  { key: "launch", docs: ["LAUNCH_BRIEF"], stages: ["LAUNCH"] },
] as const satisfies readonly { key: string; docs: readonly ProductDocKind[]; stages: readonly ProductStage[] }[];
export type FlowKey = (typeof FLOW)[number]["key"];

export type FlowDocState = "missing" | "drafting" | "draft_ready" | "saved" | "in_review" | "approved";

export async function productFlow(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "projects.read");
  const p = await productOf(db(), organizationId, companyId, productId);
  const [canAgents, canMarketing] = await Promise.all([can(ctx, "agents.read", chain), can(ctx, "marketing.manage", chain)]);
  const kinds = [...new Set(FLOW.flatMap((s) => s.docs as readonly ProductDocKind[]))];
  const projectId = p.developmentProjectId;
  const [docs, tasks, backlog, backlogDone, sprint, release, campaign, backlogAi] = await Promise.all([
    db().productDoc.findMany({ where: { productId, companyId, kind: { in: kinds } }, select: { kind: true, status: true, currentVersion: true, updatedAt: true } }),
    canAgents
      ? db().agentTask.findMany({
          where: { organizationId, companyId, subjectId: productId, subjectType: { in: kinds.map(docSubject) } },
          orderBy: { createdAt: "desc" },
          take: 60,
          select: { id: true, status: true, subjectType: true, completedAt: true },
        })
      : [],
    projectId ? db().workTask.count({ where: { companyId, projectId, archivedAt: null } }) : 0,
    projectId ? db().workTask.count({ where: { companyId, projectId, archivedAt: null, status: "DONE" } }) : 0,
    projectId ? db().sprint.findFirst({ where: { companyId, projectId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, status: true, startDate: true, endDate: true, _count: { select: { tasks: true } } } }) : null,
    db().productRelease.findFirst({ where: { productId, companyId }, orderBy: { createdAt: "desc" }, select: { id: true, version: true, status: true, notes: true, releaseDate: true } }),
    p.launchCampaignId ? db().marketingCampaign.findFirst({ where: { id: p.launchCampaignId, companyId }, select: { id: true, name: true, status: true } }) : null,
    canAgents ? db().agentTask.findFirst({ where: { organizationId, companyId, subjectType: "product", subjectId: productId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } }) : null,
  ]);

  const docView = (kind: ProductDocKind) => {
    const d = docs.find((x) => x.kind === kind);
    const task = tasks.find((x) => x.subjectType === docSubject(kind)) ?? null;
    const running = !!task && (task.status === "QUEUED" || task.status === "RUNNING");
    const fresh = !!task && task.status === "COMPLETED" && (!d || (task.completedAt != null && task.completedAt > d.updatedAt));
    const state: FlowDocState = running ? "drafting" : fresh ? "draft_ready" : d ? (d.status === "APPROVED" ? "approved" : d.status === "IN_REVIEW" ? "in_review" : "saved") : "missing";
    return { kind, state, version: d?.currentVersion ?? null, task: task ? { id: task.id, status: task.status } : null };
  };
  const savedDoc = (s: FlowDocState) => s === "saved" || s === "in_review" || s === "approved";

  const steps = FLOW.map((s) => {
    const items = (s.docs as readonly ProductDocKind[]).map(docView);
    const done =
      s.key === "backlog" ? backlog > 0 : s.key === "sprint" ? !!sprint && sprint._count.tasks > 0 : s.key === "release" ? !!release?.notes : s.key === "launch" ? items.every((d) => savedDoc(d.state)) && !!campaign : items.length > 0 && items.every((d) => savedDoc(d.state));
    return { key: s.key as FlowKey, stages: [...s.stages] as ProductStage[], docs: items, done };
  });
  const currentIndex = steps.findIndex((s) => !s.done);
  const stageAt = stageIndex(p.stage);
  return {
    product: { id: p.id, name: p.name, stage: p.stage, description: p.description, targetUsers: p.targetUsers },
    steps: steps.map((s, i) => ({ ...s, position: (s.done ? "done" : i === currentIndex ? "current" : "upcoming") as "done" | "current" | "upcoming", inStage: s.stages.some((x) => stageIndex(x) === stageAt) })),
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    backlog: { projectId, tasks: backlog, done: backlogDone, ai: backlogAi },
    sprint: sprint ? { id: sprint.id, name: sprint.name, status: sprint.status, tasks: sprint._count.tasks, endDate: dayString(sprint.endDate) } : null,
    release: release ? { id: release.id, version: release.version, status: release.status, hasNotes: !!release.notes } : null,
    campaign,
    canMarketing,
    canAgents,
  };
}
export type ProductFlow = Awaited<ReturnType<typeof productFlow>>;

async function devProjectOf(organizationId: string, companyId: string, productId: string) {
  const p = await productOf(db(), organizationId, companyId, productId);
  if (!p.developmentProjectId) throw conflict("Create the product's development project first", { reason: "work_product_no_project" });
  return { p, projectId: p.developmentProjectId };
}

const RANK = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

/**
 * Plan and start the first sprint: two weeks from today with the highest-priority open backlog tasks (up to 20). If an
 * unfinished sprint exists, unplanned backlog tasks join it instead of creating another.
 */
export async function startFirstSprint(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  await authorize(ctx, organizationId, companyId, "projects.manage");
  const { p, projectId } = await devProjectOf(organizationId, companyId, productId);
  const open = await db().workTask.findMany({
    where: { companyId, projectId, archivedAt: null, sprintId: null, parentId: null, status: { in: ["BACKLOG", "TODO"] } },
    select: { id: true, priority: true, createdAt: true },
    take: 500,
  });
  if (!open.length) throw conflict("Generate or add backlog tasks first", { reason: "work_product_backlog_empty" });
  const pick = open.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.createdAt.getTime() - b.createdAt.getTime()).slice(0, 20).map((t) => t.id);
  const existing = await db().sprint.findFirst({ where: { companyId, projectId, status: { not: "COMPLETED" } }, orderBy: { startDate: "asc" }, select: { id: true, status: true } });
  const start = today();
  const sprint = existing ?? (await createSprint(ctx, organizationId, companyId, projectId, { name: "Sprint 1", goal: `First increment of ${p.name}`.slice(0, 2000), startDate: dayString(start)!, endDate: dayString(addDays(start, 13))! }));
  const planned = await setSprintTasks(ctx, organizationId, companyId, sprint.id, { add: pick });
  await transaction(async (tx) => {
    const moved = await tx.workTask.updateMany({ where: { id: { in: pick }, companyId, status: "BACKLOG" }, data: { status: "TODO" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "product.flow.sprint_planned", resourceType: "product", resourceId: productId, newValue: { sprintId: sprint.id, added: planned.added, toTodo: moved.count } });
  });
  const status = existing?.status ?? "PLANNED";
  const active = status === "PLANNED" && !(await db().sprint.findFirst({ where: { projectId, status: "ACTIVE" }, select: { id: true } })) ? await startSprint(ctx, organizationId, companyId, sprint.id) : null;
  return { sprintId: sprint.id, added: planned.added, started: !!active || status === "ACTIVE" };
}

const bump = (v: string) => {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(v);
  return m ? `${m[1]}.${Number(m[2]) + 1}.0` : "1.0.0";
};

/**
 * Release notes from the real work: tasks completed in the development project since the last release, grouped by
 * feature, plus what is still planned in the current sprint (labelled as planned). Saved on the open release (or a new
 * planned release). Nothing is invented: with no work recorded the call refuses.
 */
export async function draftReleaseNotes(ctx: RequestContext, organizationId: string, companyId: string, productId: string) {
  await authorize(ctx, organizationId, companyId, "projects.manage");
  const { p, projectId } = await devProjectOf(organizationId, companyId, productId);
  const last = await db().productRelease.findFirst({ where: { productId, companyId }, orderBy: { createdAt: "desc" }, select: { id: true, version: true, status: true, createdAt: true } });
  const shipped = await db().productRelease.findFirst({ where: { productId, companyId, status: "RELEASED" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const since = shipped?.createdAt ?? new Date(0);
  const [done, planned] = await Promise.all([
    db().workTask.findMany({ where: { companyId, projectId, archivedAt: null, status: "DONE", completedAt: { gte: since } }, orderBy: { completedAt: "asc" }, take: 200, select: { title: true, feature: { select: { title: true } } } }),
    db().workTask.findMany({ where: { companyId, projectId, archivedAt: null, status: { notIn: ["DONE", "CANCELLED"] }, sprint: { status: { in: ["ACTIVE", "PLANNED"] } } }, take: 100, select: { title: true, feature: { select: { title: true } } } }),
  ]);
  if (!done.length && !planned.length) throw conflict("There is no completed or planned work to write release notes from yet", { reason: "work_product_no_work" });
  const group = (rows: { title: string; feature: { title: string } | null }[]) => {
    const by = new Map<string, string[]>();
    for (const r of rows) by.set(r.feature?.title ?? "", [...(by.get(r.feature?.title ?? "") ?? []), r.title]);
    return [...by.entries()].map(([f, items]) => (f ? `**${f}**\n${items.map((i) => `- ${i}`).join("\n")}` : items.map((i) => `- ${i}`).join("\n"))).join("\n\n");
  };
  const version = last && last.status !== "RELEASED" ? last.version : last ? bump(last.version) : "1.0.0";
  const notes = [
    `# ${p.name} ${version}`,
    done.length ? `## Completed\n${group(done)}` : null,
    planned.length ? `## Planned for this release (not finished yet)\n${group(planned)}` : null,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 20_000);
  const release =
    last && last.status !== "RELEASED"
      ? await updateRelease(ctx, organizationId, companyId, last.id, { notes })
      : await createRelease(ctx, organizationId, companyId, { version, productId, status: "PLANNED", notes });
  return { releaseId: release.id, version, completed: done.length, planned: planned.length };
}
