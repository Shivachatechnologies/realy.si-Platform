import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getChecklist, updateChecklist, updateChecklistInput } from "@/server/modules/work/operations";

type P = { orgId: string; companyId: string; checklistId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, checklistId }) => getChecklist(ctx, orgId, companyId, checklistId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/operations/checklists/:checklistId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, checklistId }) => updateChecklist(ctx, orgId, companyId, checklistId, await body(req, updateChecklistInput)));
