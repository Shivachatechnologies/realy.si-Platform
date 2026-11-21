import "server-only";
import { db } from "@/server/core/db";
import type { Translate } from "@/i18n/translate";
import type { RequestContext } from "@/server/core/context";
import { can } from "@/server/modules/rbac/service";
import type { ScopeChain } from "@/server/modules/rbac/scope";
import type { MetricValue } from "@/server/modules/bi/service";
import { worldOfDepartment } from "@/components/ui/world";
import type { GraphLink, GraphNode } from "@/components/graphics/network-graph";
import type { UniverseGroup } from "@/components/graphics/company-universe";

type Node = GraphNode & { group: UniverseGroup };

/**
 * The Company Universe from real records only: departments (shared Department), active AI employees (workforce),
 * products (Company Graph PRODUCT entities), customers (CRM accounts of type CUSTOMER) and revenue streams (money KPIs
 * from the metric registry). Each source is included only when the viewer may read it. Links follow real fields:
 * AI employee → its department, product ↔ graph edges / product department, customer → sales, revenue → its department.
 */
export async function companyUniverse(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  chain: ScopeChain,
  opts: { companyName: string; locale: string; t: Translate; kpis: { values: MetricValue[]; currency: string } | null; fmt: (m: MetricValue) => string },
): Promise<{ nodes: Node[]; links: GraphLink[]; counts: Record<UniverseGroup, number> }> {
  const scoped = { organizationId, companyId };
  const [canGraph, canAi, canSales, canCompany] = await Promise.all([can(ctx, "graph.read", chain), can(ctx, "agents.read", chain), can(ctx, "sales.read", chain), can(ctx, "companies.read", chain)]);
  const [departments, ai, products, productEdges, customers] = await Promise.all([
    canCompany ? db().department.findMany({ where: { ...scoped, archivedAt: null }, select: { id: true, name: true, parentId: true, _count: { select: { employees: true } } }, orderBy: { name: "asc" }, take: 40 }) : [],
    canAi ? db().aiEmployee.findMany({ where: { ...scoped, archivedAt: null }, select: { id: true, name: true, department: true, status: true, _count: { select: { tasks: true } } }, orderBy: { name: "asc" }, take: 60 }) : [],
    canGraph ? db().graphEntity.findMany({ where: { ...scoped, kind: "PRODUCT" }, select: { id: true, name: true, _count: { select: { incoming: true, outgoing: true } } }, orderBy: { name: "asc" }, take: 40 }) : [],
    canGraph ? db().graphEdge.findMany({ where: { ...scoped, OR: [{ from: { kind: "PRODUCT" } }, { to: { kind: "PRODUCT" } }] }, select: { fromId: true, toId: true }, take: 400 }) : [],
    canSales ? db().account.findMany({ where: { ...scoped, type: "CUSTOMER", mergedIntoId: null }, select: { id: true, name: true, industry: true }, orderBy: { updatedAt: "desc" }, take: 36 }) : [],
  ]);
  const L = (p: string) => `/${opts.locale}${p}`;
  const nodes: Node[] = [{ id: "company", label: opts.companyName, group: "company", center: true, weight: 4 }];
  const links: GraphLink[] = [];

  const deptByWorld = new Map<string, string>();
  for (const d of departments) {
    const id = `dept:${d.id}`;
    nodes.push({ id, label: d.name, group: "department", weight: 1.6 + Math.min(2, d._count.employees / 10), href: L("/organization"), meta: opts.t("dna.universe.meta.people", { count: d._count.employees }) });
    links.push({ source: d.parentId ? `dept:${d.parentId}` : "company", target: id });
    const w = worldOfDepartment(d.name);
    if (w !== "command" && !deptByWorld.has(w)) deptByWorld.set(w, id);
  }
  const deptFor = (dept: string | null | undefined) => deptByWorld.get(worldOfDepartment(dept)) ?? "company";

  for (const a of ai) {
    const id = `ai:${a.id}`;
    nodes.push({ id, label: a.name, group: "ai", weight: 1 + Math.min(1.5, a._count.tasks / 25), href: L(`/workforce/${a.id}`), meta: [a.department, opts.t("dna.universe.meta.tasks", { count: a._count.tasks }), a.status === "PAUSED" ? opts.t("dna.universe.meta.paused") : null].filter(Boolean).join(" · ") });
    links.push({ source: deptFor(a.department), target: id });
  }

  const productIds = new Set(products.map((p) => p.id));
  const productDept = deptByWorld.get("product") ?? "company";
  for (const p of products) {
    const id = `product:${p.id}`;
    nodes.push({ id, label: p.name, group: "product", weight: 1.2 + Math.min(1.5, (p._count.incoming + p._count.outgoing) / 6), href: L(`/graph/${p.id}`), meta: opts.t("dna.universe.meta.relations", { count: p._count.incoming + p._count.outgoing }) });
    links.push({ source: productDept, target: id });
  }
  // Product ↔ product relations recorded in the Company Graph.
  for (const e of productEdges) if (productIds.has(e.fromId) && productIds.has(e.toId)) links.push({ source: `product:${e.fromId}`, target: `product:${e.toId}` });

  const salesDept = deptByWorld.get("sales") ?? "company";
  for (const c of customers) {
    const id = `customer:${c.id}`;
    nodes.push({ id, label: c.name, group: "customer", weight: 0.8, href: L(`/crm/accounts/${c.id}`), meta: c.industry ?? undefined });
    links.push({ source: salesDept, target: id });
  }

  for (const m of opts.kpis?.values ?? []) {
    if (m.unit !== "money" || m.value === null) continue;
    const id = `revenue:${m.key}`;
    nodes.push({ id, label: opts.t(m.labelKey), group: "revenue", weight: 1.8, href: m.href ? L(m.href) : L("/analytics"), meta: opts.fmt(m) });
    links.push({ source: deptFor(m.department), target: id });
  }

  const counts = { company: 1, department: departments.length, ai: ai.length, product: products.length, customer: customers.length, revenue: nodes.filter((n) => n.group === "revenue").length };
  return { nodes, links, counts };
}

/** Real live activity: recent AI task transitions plus audit entries, newest first. */
export async function liveActivity(ctx: RequestContext, organizationId: string, companyId: string, chain: ScopeChain) {
  if (!(await can(ctx, "agents.read", chain))) return [];
  return db().agentTask.findMany({
    where: { organizationId, companyId },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: { id: true, title: true, profile: true, status: true, updatedAt: true },
  });
}

/** AI recommendations: issues raised by the latest AI CEO briefing (real AI output stored by the workforce module). */
export async function latestRecommendations(ctx: RequestContext, organizationId: string, companyId: string, chain: ScopeChain) {
  if (!(await can(ctx, "agents.read", chain))) return null;
  const b = await db().aiBriefing.findFirst({ where: { organizationId, companyId }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, issues: true, taskId: true, mode: true } });
  if (!b) return { briefing: null, issues: [] as { severity: string; message: string; href?: string }[] };
  const issues = (Array.isArray(b.issues) ? b.issues : [])
    .filter((i): i is { severity: string; message: string; href?: string } => !!i && typeof i === "object" && typeof (i as { message?: unknown }).message === "string")
    .slice(0, 5);
  return { briefing: b, issues };
}

/** Running / queued AI tasks — drives the 3D core's activity. */
export async function aiWorkload(ctx: RequestContext, organizationId: string, companyId: string, chain: ScopeChain) {
  if (!(await can(ctx, "agents.read", chain))) return null;
  const [rows, employees] = await Promise.all([
    db().agentTask.groupBy({ by: ["status"], where: { organizationId, companyId, status: { in: ["RUNNING", "QUEUED"] } }, _count: { _all: true } }),
    db().aiEmployee.count({ where: { organizationId, companyId, archivedAt: null, status: "ACTIVE" } }),
  ]);
  const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return { running: n("RUNNING"), queued: n("QUEUED"), employees };
}
