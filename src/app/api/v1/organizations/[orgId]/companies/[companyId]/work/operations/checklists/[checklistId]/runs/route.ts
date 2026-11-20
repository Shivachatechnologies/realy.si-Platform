import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { startChecklistRun } from "@/server/modules/work/operations";

type P = { orgId: string; companyId: string; checklistId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/operations/checklists/:checklistId/runs", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, checklistId }) => startChecklistRun(ctx, orgId, companyId, checklistId));
