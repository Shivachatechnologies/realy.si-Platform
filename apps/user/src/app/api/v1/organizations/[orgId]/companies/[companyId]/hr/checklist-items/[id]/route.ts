import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { itemToggleInput, toggleChecklistItem } from "@/server/modules/hr/onboarding";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/checklist-items/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => toggleChecklistItem(ctx, orgId, companyId, id, await body(req, itemToggleInput)));
