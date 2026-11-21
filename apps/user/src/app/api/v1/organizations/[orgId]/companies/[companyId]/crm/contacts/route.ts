import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { contactInput, createContact, listContacts, parseContactFilters } from "@/server/modules/crm/contacts";

type P = { orgId: string; companyId: string };

/** GET ?q=&owner=&account=&tag=&consent=&sort=&page= */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const r = await listContacts(ctx, orgId, companyId, parseContactFilters(Object.fromEntries(req.nextUrl.searchParams)));
  return { data: r.rows, total: r.total, page: r.page, pageSize: r.pageSize };
});
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/contacts", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createContact(ctx, orgId, companyId, await body(req, contactInput)),
);
