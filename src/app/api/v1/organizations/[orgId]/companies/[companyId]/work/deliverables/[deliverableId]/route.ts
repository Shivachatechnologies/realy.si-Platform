import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteDeliverable, updateDeliverable, updateDeliverableInput } from "@/server/modules/work/deliverables";

type P = { orgId: string; companyId: string; deliverableId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/deliverables/:deliverableId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, deliverableId }) => updateDeliverable(ctx, orgId, companyId, deliverableId, await body(req, updateDeliverableInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/deliverables/:deliverableId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, deliverableId }) => deleteDeliverable(ctx, orgId, companyId, deliverableId));
