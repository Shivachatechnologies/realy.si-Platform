import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getRun, runAction, runActionInput } from "@/server/modules/hr/payroll";

type P = { orgId: string; companyId: string; id: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, id }) => getRun(ctx, orgId, companyId, id));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/payroll/runs/:id", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, id }) => runAction(ctx, orgId, companyId, id, await body(req, runActionInput)));
