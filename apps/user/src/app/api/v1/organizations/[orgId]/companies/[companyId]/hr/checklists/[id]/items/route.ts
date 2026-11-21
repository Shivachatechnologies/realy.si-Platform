import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addChecklistItem, checklistItemInput } from "@/server/modules/hr/onboarding";

type P = { orgId: string; companyId: string; id: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/checklists/:id/items", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, id }) => addChecklistItem(ctx, orgId, companyId, id, await body(req, checklistItemInput)));
