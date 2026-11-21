import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listChecklists, startChecklist, startChecklistInput } from "@/server/modules/hr/onboarding";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listChecklists(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/checklists", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => startChecklist(ctx, orgId, companyId, await body(req, startChecklistInput)));
