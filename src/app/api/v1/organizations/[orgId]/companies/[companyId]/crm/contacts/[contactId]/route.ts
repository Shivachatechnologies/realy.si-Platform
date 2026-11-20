import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveContact, contactPatch, getContact, updateContact } from "@/server/modules/crm/contacts";

type P = { orgId: string; companyId: string; contactId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, contactId }) => getContact(ctx, orgId, companyId, contactId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/contacts/:contactId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, contactId }) => updateContact(ctx, orgId, companyId, contactId, await body(req, contactPatch)),
);
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/contacts/:contactId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, contactId }) =>
  archiveContact(ctx, orgId, companyId, contactId),
);
