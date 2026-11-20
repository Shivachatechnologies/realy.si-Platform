import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addProspectAsLead, dismissProspect, prospectAddInput } from "@/server/modules/crm/discovery";

type P = { orgId: string; companyId: string; prospectId: string };

/** POST turns a discovery result into a lead; DELETE dismisses it. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/prospects/:prospectId", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, prospectId }) => addProspectAsLead(ctx, orgId, companyId, prospectId, (await body(req, prospectAddInput)) as z.input<typeof prospectAddInput>),
);
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/prospects/:prospectId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, prospectId }) => dismissProspect(ctx, orgId, companyId, prospectId));
