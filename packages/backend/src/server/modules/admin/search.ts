import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { CONTROL_KEYS } from "@/server/core/platform-controls";
import { canPlatform, isUuid } from "./access";

/**
 * Global admin search: users (email/name), organizations and companies, AI tasks (id/title), platform switches and
 * integration providers. Each group appears only when the admin may read it.
 */
export async function adminSearch(ctx: RequestContext, rawQ: string) {
  const q = rawQ.trim().slice(0, 200);
  const empty = { q, users: [], organizations: [], companies: [], tasks: [], controls: [] as string[], integrations: [] as { provider: string; connections: number }[] };
  if (q.length < 2) return empty;
  const [users, orgs, ai, controls] = await Promise.all([
    canPlatform(ctx, "platform.users.read"),
    canPlatform(ctx, "platform.organizations.read"),
    canPlatform(ctx, "platform.ai.read"),
    canPlatform(ctx, "platform.audit.read"),
  ]);
  const ci = { contains: q, mode: "insensitive" as const };
  const [userRows, orgRows, companyRows, taskRows, providerRows] = await Promise.all([
    users ? db().user.findMany({ where: isUuid(q) ? { id: q } : { OR: [{ email: ci }, { name: ci }] }, take: 10, orderBy: { createdAt: "desc" }, select: { id: true, email: true, name: true, status: true } }) : [],
    orgs ? db().organization.findMany({ where: isUuid(q) ? { id: q } : { OR: [{ name: ci }, { slug: ci }] }, take: 10, orderBy: { createdAt: "desc" }, select: { id: true, name: true, slug: true, status: true } }) : [],
    orgs ? db().company.findMany({ where: isUuid(q) ? { id: q } : { OR: [{ name: ci }, { legalName: ci }] }, take: 10, orderBy: { createdAt: "desc" }, select: { id: true, name: true, organizationId: true, organization: { select: { name: true } } } }) : [],
    ai ? db().agentTask.findMany({ where: isUuid(q) ? { id: q } : { title: ci }, take: 10, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, organizationId: true } }) : [],
    orgs ? db().integrationConnection.groupBy({ by: ["provider"], where: { provider: ci }, _count: { _all: true } }) : [],
  ]);
  const needle = q.toLowerCase();
  return {
    q,
    users: userRows,
    organizations: orgRows,
    companies: companyRows,
    tasks: taskRows,
    controls: controls ? CONTROL_KEYS.filter((k) => k.toLowerCase().includes(needle)) : [],
    integrations: providerRows.map((p) => ({ provider: p.provider, connections: p._count._all })),
  };
}
