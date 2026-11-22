import { db } from "@/server/core/db";
import { SYSTEM_ROLES } from "@/server/modules/rbac/catalog";
import { canPlatform, isUuid } from "../../access";
import { ciContains, defineSearchProvider } from "../types";

/**
 * Stream B: users (email/name/id), organizations (name/slug/id), companies (name/legal name/id), platform roles
 * (built-in and custom, by key or name) and sessions (by exact id, for incident work).
 */
export const peopleSearch = defineSearchProvider({
  group: "people",
  perms: ["platform.users.read", "platform.organizations.read", "platform.security.read"],
  empty: {
    users: [] as { id: string; email: string; name: string; status: string }[],
    organizations: [] as { id: string; name: string; slug: string; status: string }[],
    companies: [] as { id: string; name: string; organizationId: string; organization: { name: string } }[],
    roles: [] as { id: string; key: string; name: string; builtIn: boolean }[],
    sessions: [] as { id: string; userId: string; user: { name: string; email: string }; revokedAt: Date | null; impersonationId: string | null }[],
  },
  async search(ctx, q) {
    const [users, orgs, security] = await Promise.all([canPlatform(ctx, "platform.users.read"), canPlatform(ctx, "platform.organizations.read"), canPlatform(ctx, "platform.security.read")]);
    const ci = ciContains(q);
    const needle = q.trim().toLowerCase();
    const builtIn = needle
      ? SYSTEM_ROLES.filter((r) => r.assignableAt.includes("PLATFORM") && (r.key.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle))).map((r) => ({ id: r.key, key: r.key, name: r.name, builtIn: true }))
      : [];
    const [userRows, orgRows, companyRows, customRoles, sessionRows] = await Promise.all([
      users ? db().user.findMany({ where: isUuid(q) ? { id: q } : { OR: [{ email: ci }, { name: ci }] }, take: 10, orderBy: { createdAt: "desc" }, select: { id: true, email: true, name: true, status: true } }) : [],
      orgs ? db().organization.findMany({ where: isUuid(q) ? { id: q } : { OR: [{ name: ci }, { slug: ci }] }, take: 10, orderBy: { createdAt: "desc" }, select: { id: true, name: true, slug: true, status: true } }) : [],
      orgs ? db().company.findMany({ where: isUuid(q) ? { id: q } : { OR: [{ name: ci }, { legalName: ci }] }, take: 10, orderBy: { createdAt: "desc" }, select: { id: true, name: true, organizationId: true, organization: { select: { name: true } } } }) : [],
      users || security ? db().role.findMany({ where: { organizationId: null, isSystem: false, assignableAt: { has: "PLATFORM" }, ...(isUuid(q) ? { id: q } : { OR: [{ key: ci }, { name: ci }] }) }, take: 10, select: { id: true, key: true, name: true } }) : [],
      (users || security) && isUuid(q) ? db().session.findMany({ where: { id: q }, take: 1, select: { id: true, userId: true, revokedAt: true, impersonationId: true, user: { select: { name: true, email: true } } } }) : [],
    ]);
    const roles = users || security ? [...builtIn, ...customRoles.map((r) => ({ ...r, builtIn: false }))].slice(0, 10) : [];
    return { users: userRows, organizations: orgRows, companies: companyRows, roles, sessions: sessionRows };
  },
});
