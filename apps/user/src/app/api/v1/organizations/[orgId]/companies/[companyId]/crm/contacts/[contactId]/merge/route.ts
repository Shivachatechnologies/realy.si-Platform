import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { mergeContacts, mergeContactsInput } from "@/server/modules/crm/contacts";

type P = { orgId: string; companyId: string; contactId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/contacts/:contactId/merge", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, contactId }) => mergeContacts(ctx, orgId, companyId, contactId, await body(req, mergeContactsInput)),
);
