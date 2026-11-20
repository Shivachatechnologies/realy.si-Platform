import type { RequestContext } from "@/server/core/context";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import type { ScopeChain } from "@/server/modules/rbac/scope";
import { departmentOf } from "./service";

export interface NetworkData {
  departments: { key: string; employees: { id: string; name: string; initials: string; busy: boolean; paused: boolean }[] }[];
  /** Key record clusters per department, counted from real tables (null = viewer may not see them). */
  records: { key: "customers" | "deals" | "leads" | "projects" | "tickets" | "invoices"; department: string; count: number; href: string }[];
  /** Manager links between AI employees. */
  links: { from: string; to: string }[];
}

const allowed = async (ctx: RequestContext, p: string, chain: ScopeChain) => {
  try {
    return await can(ctx, p, chain);
  } catch {
    return false;
  }
};

/** The company as a network: departments ↔ AI employees ↔ key record clusters (counts), all from real data. */
export async function companyNetwork(ctx: RequestContext, chain: ScopeChain, organizationId: string, companyId: string): Promise<NetworkData> {
  const scope = { organizationId, companyId };
  const [sales, projects, support, finance] = await Promise.all(["sales.read", "projects.read", "support.read", "finance.read"].map((p) => allowed(ctx, p, chain)));
  const [employees, busy, customers, deals, leads, projectCount, tickets, invoices] = await Promise.all([
    db().aiEmployee.findMany({ where: { ...scope, archivedAt: null }, select: { id: true, name: true, initials: true, profileKey: true, status: true, managerEmployeeId: true }, take: 60 }),
    db().agentTask.findMany({ where: { ...scope, status: { in: ["RUNNING", "QUEUED"] }, aiEmployeeId: { not: null } }, select: { aiEmployeeId: true }, distinct: ["aiEmployeeId"] }),
    sales ? db().account.count({ where: { ...scope, type: "CUSTOMER", archivedAt: null } }) : null,
    sales ? db().crmDeal.count({ where: { ...scope, status: "OPEN" } }) : null,
    sales ? db().lead.count({ where: { ...scope, archivedAt: null, stage: { notIn: ["WON", "LOST"] } } }) : null,
    projects ? db().project.count({ where: { ...scope, archivedAt: null } }) : null,
    support ? db().supportTicket.count({ where: { ...scope, status: { notIn: ["SOLVED", "CLOSED"] } } }) : null,
    finance ? db().invoice.count({ where: { ...scope, status: { in: ["SENT", "OVERDUE"] } } }).catch(() => null) : null,
  ]);
  const busySet = new Set(busy.map((b) => b.aiEmployeeId));
  const byDept = new Map<string, NetworkData["departments"][number]["employees"]>();
  for (const e of employees) {
    const d = departmentOf(e.profileKey);
    byDept.set(d, [...(byDept.get(d) ?? []), { id: e.id, name: e.name, initials: e.initials, busy: busySet.has(e.id), paused: e.status === "PAUSED" }]);
  }
  const records: NetworkData["records"] = [];
  const push = (key: NetworkData["records"][number]["key"], department: string, count: number | null, href: string) => {
    if (count !== null) records.push({ key, department, count, href });
  };
  push("customers", "sales", customers, "/customers");
  push("deals", "sales", deals, "/crm/deals");
  push("leads", "marketing", leads, "/crm");
  push("projects", "operations", projectCount, "/projects");
  push("tickets", "support", tickets, "/support");
  push("invoices", "finance", invoices, "/finance");
  for (const r of records) if (!byDept.has(r.department)) byDept.set(r.department, []);
  const ids = new Set(employees.map((e) => e.id));
  return {
    departments: [...byDept.entries()].map(([key, list]) => ({ key, employees: list })),
    records,
    links: employees.filter((e) => e.managerEmployeeId && ids.has(e.managerEmployeeId)).map((e) => ({ from: e.managerEmployeeId!, to: e.id })),
  };
}
