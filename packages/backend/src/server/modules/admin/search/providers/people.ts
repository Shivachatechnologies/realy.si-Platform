import { db } from "@/server/core/db";
import { canPlatform, isUuid } from "../../access";
import { ciContains, defineSearchProvider } from "../types";

/** Stream B: users (email/name/id), organizations (name/slug/id) and companies (name/legal name/id). */
export const peopleSearch = defineSearchProvider({
  group: "people",
  perms: ["platform.users.read", "platform.organizations.read"],
  empty: {
    users: [] as { id: string; email: string; name: string; status: string }[],
    organizations: [] as { id: string; name: string; slug: string; status: string }[],
    companies: [] as { id: string; name: string; organizationId: string; organization: { name: string } }[],
  },
  async search(ctx, q) {
    const [users, orgs] = await Promise.all([canPlatform(ctx, "platform.users.read"), canPlatform(ctx, "platform.organizations.read")]);
    const ci = ciContains(q);
    const [userRows, orgRows, companyRows] = await Promise.all([
      users ? db().user.findMany({ where: isUuid(q) ? { id: q } : { OR: [{ email: ci }, { name: ci }] }, take: 10, orderBy: { createdAt: "desc" }, select: { id: true, email: true, name: true, status: true } }) : [],
      orgs ? db().organization.findMany({ where: isUuid(q) ? { id: q } : { OR: [{ name: ci }, { slug: ci }] }, take: 10, orderBy: { createdAt: "desc" }, select: { id: true, name: true, slug: true, status: true } }) : [],
      orgs ? db().company.findMany({ where: isUuid(q) ? { id: q } : { OR: [{ name: ci }, { legalName: ci }] }, take: 10, orderBy: { createdAt: "desc" }, select: { id: true, name: true, organizationId: true, organization: { select: { name: true } } } }) : [],
    ]);
    return { users: userRows, organizations: orgRows, companies: companyRows };
  },
});
