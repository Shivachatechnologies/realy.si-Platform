import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { createTask as createAgentTask } from "@/server/modules/agents/service";
import { can } from "@/server/modules/rbac/service";
import { addDays, authorize, dayString, today } from "./shared";
import { createWorkTask } from "./tasks";
import { getProcess } from "./operations";

/**
 * Operations analytics: bottlenecks detected from the company's real records — checklist runs past due, workflow runs
 * stuck or failing, support tickets waiting too long, approvals left pending, and slow task cycle times / stalled work.
 * Each bottleneck offers "fix this" actions: a follow-up task, or an automation draft written by the automation architect
 * (never published automatically). Areas the viewer may not read are left out.
 */

export type BottleneckArea = "checklists" | "workflows" | "support" | "approvals" | "tasks";
export interface Bottleneck {
  key: string;
  area: BottleneckArea;
  kind: string;
  severity: "high" | "medium" | "low";
  count: number;
  /** Age of the oldest item in days. */
  ageDays: number;
  /** Label of the main record (checklist title, workflow name, project name). */
  label: string | null;
  href: string;
  /** Plain description used for the fix task / automation draft. */
  summary: string;
}

const DAY = 86_400_000;
const ageDays = (d: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY));
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export async function detectBottlenecks(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "operations.read");
  const now = new Date();
  const day0 = today(now);
  const [seeSupport, seeWorkflows, seeFinance, seeApprovals, seeProjects] = await Promise.all([
    can(ctx, "support.read", chain),
    can(ctx, "workflows.read", chain),
    can(ctx, "finance.read", chain),
    can(ctx, "approvals.read", chain),
    can(ctx, "projects.read", chain),
  ]);
  const base = { organizationId, companyId };
  const out: Bottleneck[] = [];

  // Checklist runs past their due day with open steps.
  const runs = await db().opsChecklistRun.findMany({ where: { ...base, completedAt: null, dueOn: { lt: day0 } }, orderBy: { dueOn: "asc" }, take: 100, select: { id: true, dueOn: true, items: true, checklistId: true, checklist: { select: { title: true } } } });
  const byChecklist = new Map<string, typeof runs>();
  for (const r of runs) byChecklist.set(r.checklistId, [...(byChecklist.get(r.checklistId) ?? []), r]);
  for (const [checklistId, rs] of byChecklist) {
    const open = rs.reduce((s, r) => s + (Array.isArray(r.items) ? (r.items as { done?: boolean }[]).filter((i) => !i?.done).length : 0), 0);
    const age = ageDays(rs[0]!.dueOn, day0);
    out.push({
      key: `checklist:${checklistId}`,
      area: "checklists",
      kind: "overdue_checklist",
      severity: age > 7 || rs.length > 2 ? "high" : "medium",
      count: rs.length,
      ageDays: age,
      label: rs[0]!.checklist.title,
      href: `/operations/checklists/${checklistId}`,
      summary: `Checklist "${rs[0]!.checklist.title}": ${rs.length} run(s) past due (oldest due ${dayString(rs[0]!.dueOn)}), ${open} step(s) still open.`,
    });
  }

  if (seeWorkflows) {
    const [stuck, failed] = await Promise.all([
      db().workflowRun.findMany({
        where: { ...base, isTest: false, OR: [{ status: { in: ["QUEUED", "RUNNING"] }, updatedAt: { lt: new Date(now.getTime() - 60 * 60_000) } }, { status: "WAITING", updatedAt: { lt: new Date(now.getTime() - 3 * DAY) } }] },
        orderBy: { updatedAt: "asc" },
        take: 200,
        select: { workflowId: true, status: true, updatedAt: true, waitingFor: true, workflow: { select: { name: true } } },
      }),
      db().workflowRun.groupBy({ by: ["workflowId"], where: { ...base, isTest: false, status: "FAILED", createdAt: { gte: new Date(now.getTime() - 7 * DAY) } }, _count: { _all: true }, _min: { createdAt: true } }),
    ]);
    const grouped = new Map<string, typeof stuck>();
    for (const r of stuck) grouped.set(r.workflowId, [...(grouped.get(r.workflowId) ?? []), r]);
    for (const [workflowId, rs] of grouped) {
      const age = ageDays(rs[0]!.updatedAt, now);
      out.push({
        key: `workflow_stuck:${workflowId}`,
        area: "workflows",
        kind: "stuck_runs",
        severity: rs.length >= 5 || age >= 3 ? "high" : "medium",
        count: rs.length,
        ageDays: age,
        label: rs[0]!.workflow.name,
        href: `/workflows/${workflowId}`,
        summary: `Workflow "${rs[0]!.workflow.name}": ${rs.length} run(s) not progressing (${[...new Set(rs.map((r) => r.status))].join(", ")}${rs[0]!.waitingFor ? `, waiting for ${rs[0]!.waitingFor}` : ""}) since ${dayString(rs[0]!.updatedAt)}.`,
      });
    }
    const names = failed.length ? await db().workflow.findMany({ where: { ...base, id: { in: failed.map((f) => f.workflowId) } }, select: { id: true, name: true } }) : [];
    for (const f of failed.filter((x) => x._count._all >= 2)) {
      const name = names.find((n) => n.id === f.workflowId)?.name ?? null;
      out.push({
        key: `workflow_failed:${f.workflowId}`,
        area: "workflows",
        kind: "failing_runs",
        severity: f._count._all >= 5 ? "high" : "medium",
        count: f._count._all,
        ageDays: f._min.createdAt ? ageDays(f._min.createdAt, now) : 0,
        label: name,
        href: `/workflows/${f.workflowId}`,
        summary: `Workflow "${name ?? f.workflowId}" failed ${f._count._all} time(s) in the last 7 days.`,
      });
    }
  }

  if (seeSupport) {
    const slow = await db().supportTicket.findMany({
      where: { ...base, status: { in: ["NEW", "OPEN", "PENDING", "ON_HOLD"] }, OR: [{ createdAt: { lt: new Date(now.getTime() - 3 * DAY) } }, { resolutionBreachedAt: { not: null } }, { firstResponseBreachedAt: { not: null } }] },
      orderBy: { createdAt: "asc" },
      take: 500,
      select: { id: true, createdAt: true, firstRespondedAt: true, resolutionBreachedAt: true, firstResponseBreachedAt: true, assigneeId: true },
    });
    if (slow.length) {
      const breached = slow.filter((t) => t.resolutionBreachedAt || t.firstResponseBreachedAt).length;
      const unanswered = slow.filter((t) => !t.firstRespondedAt).length;
      const unassigned = slow.filter((t) => !t.assigneeId).length;
      out.push({
        key: "support:slow",
        area: "support",
        kind: "slow_tickets",
        severity: breached >= 3 || ageDays(slow[0]!.createdAt, now) > 7 ? "high" : "medium",
        count: slow.length,
        ageDays: ageDays(slow[0]!.createdAt, now),
        label: null,
        href: "/support?view=breached",
        summary: `${slow.length} open support ticket(s) older than 3 days or past their SLA: ${breached} breached the SLA, ${unanswered} still without a first reply, ${unassigned} unassigned. Oldest opened ${dayString(slow[0]!.createdAt)}.`,
      });
    }
  }

  const aging: { label: string; count: number; oldest: Date; href: string }[] = [];
  if (seeApprovals) {
    const a = await db().approval.findMany({ where: { ...base, status: "PENDING", createdAt: { lt: new Date(now.getTime() - DAY) } }, orderBy: { createdAt: "asc" }, take: 200, select: { createdAt: true } });
    if (a.length) aging.push({ label: "AI actions waiting for approval", count: a.length, oldest: a[0]!.createdAt, href: "/approvals" });
  }
  if (seeWorkflows) {
    const w = await db().workflowApprovalRequest.findMany({ where: { ...base, status: "PENDING", createdAt: { lt: new Date(now.getTime() - DAY) } }, orderBy: { createdAt: "asc" }, take: 200, select: { createdAt: true } });
    if (w.length) aging.push({ label: "workflow approval steps", count: w.length, oldest: w[0]!.createdAt, href: "/workflows" });
  }
  if (seeFinance) {
    const f = await db().financeApprovalRequest.findMany({ where: { ...base, status: "PENDING", createdAt: { lt: new Date(now.getTime() - 3 * DAY) } }, orderBy: { createdAt: "asc" }, take: 200, select: { createdAt: true } });
    if (f.length) aging.push({ label: "finance approvals (bills, expenses)", count: f.length, oldest: f[0]!.createdAt, href: "/finance/approvals" });
  }
  for (const a of aging) {
    const age = ageDays(a.oldest, now);
    out.push({
      key: `approvals:${a.href}`,
      area: "approvals",
      kind: "aging_approvals",
      severity: age >= 5 || a.count >= 10 ? "high" : "medium",
      count: a.count,
      ageDays: age,
      label: a.label,
      href: a.href,
      summary: `${a.count} ${a.label} pending; the oldest has waited ${age} day(s).`,
    });
  }

  // Task cycle times (created → done, last 60 days) per project vs the company median, and work in progress that stalled.
  let cycle: { companyMedianDays: number | null; projects: { projectId: string; name: string; medianDays: number; done: number }[] } = { companyMedianDays: null, projects: [] };
  if (seeProjects) {
    const [done, stalled] = await Promise.all([
      db().workTask.findMany({ where: { ...base, status: "DONE", completedAt: { gte: addDays(day0, -60) } }, select: { projectId: true, createdAt: true, completedAt: true, project: { select: { name: true } } }, take: 10_000 }),
      db().workTask.findMany({ where: { ...base, archivedAt: null, status: { in: ["IN_PROGRESS", "IN_REVIEW"] }, updatedAt: { lt: addDays(now, -14) } }, select: { projectId: true, updatedAt: true, project: { select: { name: true } } }, orderBy: { updatedAt: "asc" }, take: 500 }),
    ]);
    const days = (t: { createdAt: Date; completedAt: Date | null }) => (t.completedAt!.getTime() - t.createdAt.getTime()) / DAY;
    const all = median(done.map(days));
    const per = new Map<string, { name: string; xs: number[] }>();
    for (const t of done) if (t.projectId) per.set(t.projectId, { name: t.project?.name ?? "", xs: [...(per.get(t.projectId)?.xs ?? []), days(t)] });
    cycle = {
      companyMedianDays: all != null ? Math.round(all * 10) / 10 : null,
      projects: [...per.entries()].map(([projectId, v]) => ({ projectId, name: v.name, medianDays: Math.round((median(v.xs) ?? 0) * 10) / 10, done: v.xs.length })).sort((a, b) => b.medianDays - a.medianDays).slice(0, 8),
    };
    for (const p of cycle.projects) {
      if (all == null || p.done < 5 || p.medianDays < all * 1.5 || p.medianDays < 3) continue;
      out.push({
        key: `cycle:${p.projectId}`,
        area: "tasks",
        kind: "slow_cycle",
        severity: p.medianDays >= all * 2.5 ? "high" : "low",
        count: p.done,
        ageDays: Math.round(p.medianDays),
        label: p.name,
        href: `/projects/${p.projectId}`,
        summary: `Project "${p.name}": tasks take a median of ${p.medianDays} days from creation to done (company median ${cycle.companyMedianDays} days, ${p.done} tasks in the last 60 days).`,
      });
    }
    if (stalled.length) {
      out.push({
        key: "tasks:stalled",
        area: "tasks",
        kind: "stalled_wip",
        severity: stalled.length >= 10 ? "high" : "medium",
        count: stalled.length,
        ageDays: ageDays(stalled[0]!.updatedAt, now),
        label: null,
        href: "/projects/tasks?status=IN_PROGRESS",
        summary: `${stalled.length} task(s) in progress or in review with no update for over 14 days${stalled[0]!.project ? ` (e.g. in "${stalled[0]!.project.name}")` : ""}.`,
      });
    }
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.ageDays - a.ageDays);
  const byArea = Object.fromEntries((["checklists", "workflows", "support", "approvals", "tasks"] as const).map((a) => [a, out.filter((b) => b.area === a).reduce((s, b) => s + b.count, 0)])) as Record<BottleneckArea, number>;
  return { items: out, byArea, cycle, visible: { support: seeSupport, workflows: seeWorkflows, finance: seeFinance, approvals: seeApprovals, projects: seeProjects }, checkedAt: now };
}

export const fixInput = z.object({ key: z.string().min(3).max(200), action: z.enum(["task", "automation"]) });

/** "Fix this": a follow-up task (projects.manage) or an automation draft by the automation architect (workflows.manage). */
export async function fixBottleneck(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof fixInput>) {
  const input = fixInput.parse(raw);
  const found = (await detectBottlenecks(ctx, organizationId, companyId)).items.find((b) => b.key === input.key);
  if (!found) throw notFound("Bottleneck");
  if (input.action === "task") {
    const t = await createWorkTask(ctx, organizationId, companyId, {
      title: `Fix bottleneck: ${found.label ?? found.kind.replace(/_/g, " ")}`.slice(0, 300),
      description: `${found.summary}\n\nDetected by Operations analytics on ${dayString(today())}. Open: ${found.href}`,
      priority: found.severity === "high" ? "HIGH" : "MEDIUM",
      dueDate: dayString(addDays(today(), found.severity === "high" ? 2 : 5)),
      labels: ["operations", "bottleneck"],
    });
    return { kind: "task" as const, taskId: t.id };
  }
  // Loaded lazily: the automation service is web-only ("server-only"), while this file is also loaded by the worker's tool registry.
  const { createWorkflow, requestAiDraft } = await import("@/server/modules/automation/service");
  const wf = await createWorkflow(ctx, organizationId, companyId, { name: `Fix: ${found.label ?? found.kind.replace(/_/g, " ")}`.slice(0, 160), description: found.summary.slice(0, 2000) });
  const task = await requestAiDraft(ctx, organizationId, companyId, wf.id, {
    description: `Design an automation that prevents or resolves this recurring operations bottleneck: ${found.summary} Prefer reminders, escalations to the right owner and follow-up tasks over irreversible actions.`,
  });
  return { kind: "automation" as const, workflowId: wf.id, taskId: task.id };
}

// ───────────── SOP generation ─────────────

export const sopInput = z.object({ guidance: z.string().trim().max(1000).optional() });

/** An operations_manager task that turns a process into a standard operating procedure and proposes it as a new version. */
export async function requestSopDraft(ctx: RequestContext, organizationId: string, companyId: string, processId: string, raw: z.input<typeof sopInput>) {
  const input = sopInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "operations.manage");
  const p = await getProcess(ctx, organizationId, companyId, processId);
  return createAgentTask(ctx, organizationId, companyId, {
    profile: "operations_manager",
    title: `SOP: ${p.title}`.slice(0, 200),
    subject: { type: "ops_process", id: p.id },
    instructions: [
      `Turn the process "${p.title}" (id ${p.id}) into a clear standard operating procedure. Read it with read_process, and use search_company_brain for related documents and read_ops_bottlenecks to see where operations currently get stuck.`,
      "Write the SOP as ordered steps: each step one action with its owner role, the inputs it needs, what \"done\" looks like, and the time it should take; add checks for the points where work tends to stall and an escalation rule. Keep the language plain for a non-specialist.",
      "Then propose it as a new version of the process with propose_process_version (steps with title and detail, and a change note). A person approves it before it is saved. Do not invent tools, systems or people the company does not have — mark assumptions.",
      input.guidance ? `Additional direction from the requester: ${input.guidance}` : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
}
