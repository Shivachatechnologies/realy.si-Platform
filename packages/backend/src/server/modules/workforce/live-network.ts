import { z } from "zod";
import type { RequestContext } from "@/server/core/context";
import { db } from "@/server/core/db";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";

/**
 * Live company network (/workforce/network): the real org chart — AI CEO at the centre, executives, managers,
 * specialists — plus the human team (HR employee records with their manager lines, and members AI employees report
 * to), and live signals read from real task, delegation, approval, call and report rows. No synthetic activity.
 */

export type LiveLevel = "CEO" | "EXECUTIVE" | "MANAGER" | "SPECIALIST" | "HUMAN";

export interface LiveNode {
  /** "ai:<uuid>", "hr:<employee uuid>" or "user:<user uuid>". */
  id: string;
  kind: "ai" | "human";
  name: string;
  initials: string;
  level: LiveLevel;
  department: string;
  title: string | null;
  profileKey: string | null;
  status: "active" | "busy" | "paused" | "away";
  /** Node id of the manager (null = top). */
  managerId: string | null;
  /** Depth from the centre (0 = CEO / founder). */
  depth: number;
}

export interface LiveGraph {
  nodes: LiveNode[];
  centerId: string | null;
  counts: { ai: number; humans: number; busy: number; paused: number };
  /** False when the viewer may not see HR records (human nodes then only include members AI employees report to). */
  humansVisible: boolean;
  generatedAt: string;
}

export type SignalKind = "task" | "done" | "failed" | "delegation" | "approval" | "call" | "escalation" | "rollup";
export interface LiveSignal {
  id: string;
  kind: SignalKind;
  from: string;
  /** Target node (delegations, reports); equal to `from` for single-node events. */
  to: string;
  at: string;
  label: string;
}

const MAX_AI = 5000;
const MAX_HUMANS = 3000;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join("") || "?";

async function authorize(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "agents.read", chain);
  return chain;
}

export async function liveGraph(ctx: RequestContext, organizationId: string, companyId: string): Promise<LiveGraph> {
  const chain = await authorize(ctx, organizationId, companyId);
  const scope = { organizationId, companyId };
  const humansVisible = await can(ctx, "hr.read", chain).catch(() => false);
  const [ai, busy, humans] = await Promise.all([
    db().aiEmployee.findMany({ where: { ...scope, archivedAt: null }, select: { id: true, name: true, initials: true, profileKey: true, department: true, level: true, jobTitle: true, status: true, managerEmployeeId: true, managerUserId: true }, take: MAX_AI, orderBy: { createdAt: "asc" } }),
    db().agentTask.groupBy({ by: ["aiEmployeeId"], where: { ...scope, status: "RUNNING", aiEmployeeId: { not: null } }, _count: { _all: true } }),
    humansVisible
      ? db().employee.findMany({ where: { ...scope, archivedAt: null, status: { not: "TERMINATED" } }, select: { id: true, userId: true, firstName: true, lastName: true, title: true, managerId: true, status: true, department: { select: { name: true } } }, take: MAX_HUMANS })
      : Promise.resolve([]),
  ]);
  const busySet = new Set(busy.map((b) => b.aiEmployeeId));
  const nodes = new Map<string, LiveNode>();
  const aiIds = new Set(ai.map((e) => e.id));
  // CEO: the ai_ceo role, else the first root executive.
  const ceo = ai.find((e) => e.profileKey === "ai_ceo" && (!e.managerEmployeeId || !aiIds.has(e.managerEmployeeId))) ?? ai.find((e) => e.level === "EXECUTIVE" && !e.managerEmployeeId) ?? null;
  const userToHr = new Map<string, string>();
  for (const h of humans) {
    const id = `hr:${h.id}`;
    if (h.userId) userToHr.set(h.userId, id);
    const name = [h.firstName, h.lastName].filter(Boolean).join(" ");
    nodes.set(id, { id, kind: "human", name, initials: initials(name), level: "HUMAN", department: h.department?.name ?? "people", title: h.title, profileKey: null, status: h.status === "ON_LEAVE" ? "away" : "active", managerId: null, depth: 0 });
  }
  for (const h of humans) {
    const n = nodes.get(`hr:${h.id}`)!;
    if (h.managerId && nodes.has(`hr:${h.managerId}`)) n.managerId = `hr:${h.managerId}`;
  }
  // Members AI employees report to, without a visible HR record.
  const memberIds = [...new Set(ai.flatMap((e) => (e.managerUserId && !userToHr.has(e.managerUserId) ? [e.managerUserId] : [])))];
  if (memberIds.length) {
    const users = await db().user.findMany({ where: { id: { in: memberIds }, memberships: { some: { organizationId } } }, select: { id: true, name: true } });
    for (const u of users) nodes.set(`user:${u.id}`, { id: `user:${u.id}`, kind: "human", name: u.name, initials: initials(u.name), level: "HUMAN", department: "executive", title: null, profileKey: null, status: "active", managerId: null, depth: 0 });
  }
  const humanOf = (userId: string | null) => (userId ? (userToHr.get(userId) ?? (nodes.has(`user:${userId}`) ? `user:${userId}` : null)) : null);
  for (const e of ai) {
    const id = `ai:${e.id}`;
    const managerId = e.managerEmployeeId && aiIds.has(e.managerEmployeeId) ? `ai:${e.managerEmployeeId}` : humanOf(e.managerUserId);
    nodes.set(id, {
      id,
      kind: "ai",
      name: e.name,
      initials: e.initials,
      level: ceo && e.id === ceo.id ? "CEO" : e.level,
      department: e.department,
      title: e.jobTitle,
      profileKey: e.profileKey,
      status: e.status === "PAUSED" ? "paused" : busySet.has(e.id) ? "busy" : "active",
      managerId,
      depth: 0,
    });
  }
  // Depth from the centre (cycle-safe).
  const centerId = ceo ? `ai:${ceo.id}` : null;
  for (const n of nodes.values()) {
    let d = 0;
    let cursor = n.managerId;
    const seen = new Set([n.id]);
    while (cursor && !seen.has(cursor) && d < 40) {
      seen.add(cursor);
      d++;
      cursor = nodes.get(cursor)?.managerId ?? null;
    }
    n.depth = d;
  }
  const list = [...nodes.values()];
  return {
    nodes: list,
    centerId,
    counts: { ai: ai.length, humans: list.length - ai.length, busy: busySet.size, paused: ai.filter((e) => e.status === "PAUSED").length },
    humansVisible,
    generatedAt: new Date().toISOString(),
  };
}

export const signalsQuery = z.object({ since: z.coerce.date().optional().catch(undefined) });

/** Live signals since `since` (at most 10 minutes back, at most 200), oldest first. */
export async function liveSignals(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, unknown> = {}): Promise<{ signals: LiveSignal[]; now: string }> {
  await authorize(ctx, organizationId, companyId);
  const now = new Date();
  const floor = new Date(now.getTime() - 10 * 60_000);
  const q = signalsQuery.parse(raw);
  const since = q.since && q.since > floor ? q.since : floor;
  const scope = { organizationId, companyId };
  const [created, finished, delegations, approvals, reports, calls] = await Promise.all([
    db().agentTask.findMany({ where: { ...scope, createdAt: { gt: since }, aiEmployeeId: { not: null } }, select: { id: true, title: true, createdAt: true, aiEmployeeId: true, parentTask: { select: { aiEmployeeId: true } } }, take: 200, orderBy: { createdAt: "desc" } }),
    db().agentTask.findMany({ where: { ...scope, completedAt: { gt: since }, aiEmployeeId: { not: null }, status: { in: ["COMPLETED", "FAILED"] } }, select: { id: true, title: true, status: true, completedAt: true, aiEmployeeId: true }, take: 200, orderBy: { completedAt: "desc" } }),
    db().aiDelegation.findMany({ where: { ...scope, createdAt: { gt: since } }, select: { id: true, title: true, createdAt: true, fromEmployeeId: true, toEmployeeId: true }, take: 100 }),
    db().approval.findMany({ where: { ...scope, createdAt: { gt: since }, task: { aiEmployeeId: { not: null } } }, select: { id: true, summary: true, createdAt: true, task: { select: { aiEmployeeId: true } } }, take: 100 }),
    db().aiEmployeeReport.findMany({ where: { ...scope, createdAt: { gt: since }, kind: { in: ["ESCALATION", "ROLLUP"] } }, select: { id: true, kind: true, title: true, createdAt: true, aiEmployeeId: true, managerEmployeeId: true, managerUserId: true }, take: 100 }),
    db().voiceCall.findMany({ where: { ...scope, createdAt: { gt: since }, agentId: { not: null } }, select: { id: true, direction: true, createdAt: true, agentId: true }, take: 100 }),
  ]);
  const agentIds = [...new Set(calls.map((c) => c.agentId!))];
  const agents = agentIds.length ? await db().voiceAgent.findMany({ where: { id: { in: agentIds }, companyId }, select: { id: true, aiEmployeeId: true } }) : [];
  const agentEmployee = new Map(agents.map((a) => [a.id, a.aiEmployeeId]));
  const out: LiveSignal[] = [];
  const ai = (id: string | null | undefined) => (id ? `ai:${id}` : null);
  for (const t of created) {
    const from = ai(t.parentTask?.aiEmployeeId) ?? ai(t.aiEmployeeId)!;
    out.push({ id: `t:${t.id}`, kind: "task", from, to: ai(t.aiEmployeeId)!, at: t.createdAt.toISOString(), label: t.title });
  }
  for (const t of finished) out.push({ id: `f:${t.id}`, kind: t.status === "COMPLETED" ? "done" : "failed", from: ai(t.aiEmployeeId)!, to: ai(t.aiEmployeeId)!, at: t.completedAt!.toISOString(), label: t.title });
  for (const d of delegations) out.push({ id: `d:${d.id}`, kind: "delegation", from: ai(d.fromEmployeeId)!, to: ai(d.toEmployeeId)!, at: d.createdAt.toISOString(), label: d.title });
  for (const a of approvals) out.push({ id: `a:${a.id}`, kind: "approval", from: ai(a.task?.aiEmployeeId)!, to: ai(a.task?.aiEmployeeId)!, at: a.createdAt.toISOString(), label: a.summary.slice(0, 160) });
  for (const r of reports) {
    const to = ai(r.managerEmployeeId) ?? (r.managerUserId ? `user:${r.managerUserId}` : ai(r.aiEmployeeId)!);
    out.push({ id: `r:${r.id}`, kind: r.kind === "ESCALATION" ? "escalation" : "rollup", from: ai(r.aiEmployeeId)!, to, at: r.createdAt.toISOString(), label: r.title });
  }
  for (const c of calls) {
    const e = agentEmployee.get(c.agentId!);
    if (e) out.push({ id: `c:${c.id}`, kind: "call", from: `ai:${e}`, to: `ai:${e}`, at: c.createdAt.toISOString(), label: c.direction });
  }
  out.sort((a, b) => a.at.localeCompare(b.at));
  return { signals: out.slice(-200), now: now.toISOString() };
}

/** Profile drawer data for a human node (HR record, only with hr.read). */
export async function humanNode(ctx: RequestContext, organizationId: string, companyId: string, nodeId: string) {
  const chain = await authorize(ctx, organizationId, companyId);
  const [kind, id] = nodeId.split(":");
  if (!id || !z.string().uuid().safeParse(id).success) return null;
  const reportsAi = await db().aiEmployee.findMany({ where: { organizationId, companyId, archivedAt: null, managerUserId: kind === "user" ? id : undefined, ...(kind === "hr" ? { managerUserId: { not: null } } : {}) }, select: { id: true, name: true, managerUserId: true }, take: 200 });
  if (kind === "user") {
    const u = await db().user.findFirst({ where: { id, memberships: { some: { organizationId } } }, select: { id: true, name: true } });
    return u ? { kind: "member" as const, id: u.id, name: u.name, title: null, email: null, department: null, manager: null, aiReports: reportsAi.map((r) => ({ id: r.id, name: r.name })), humanReports: [] as { id: string; name: string }[] } : null;
  }
  if (kind !== "hr" || !(await can(ctx, "hr.read", chain).catch(() => false))) return null;
  const h = await db().employee.findFirst({
    where: { id, organizationId, companyId },
    select: { id: true, userId: true, firstName: true, lastName: true, title: true, email: true, department: { select: { name: true } }, manager: { select: { id: true, firstName: true, lastName: true } }, reports: { where: { archivedAt: null }, select: { id: true, firstName: true, lastName: true }, take: 50 } },
  });
  if (!h) return null;
  const full = (p: { firstName: string; lastName: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(" ");
  return {
    kind: "employee" as const,
    id: h.id,
    name: full(h),
    title: h.title,
    email: h.email,
    department: h.department?.name ?? null,
    manager: h.manager ? { id: h.manager.id, name: full(h.manager) } : null,
    aiReports: h.userId ? reportsAi.filter((r) => r.managerUserId === h.userId).map((r) => ({ id: r.id, name: r.name })) : [],
    humanReports: h.reports.map((r) => ({ id: r.id, name: full(r) })),
  };
}
