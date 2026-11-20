import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createKpi, kpiInput } from "@/server/modules/hr/performance";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/kpis", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createKpi(ctx, orgId, companyId, await body(req, kpiInput)));
