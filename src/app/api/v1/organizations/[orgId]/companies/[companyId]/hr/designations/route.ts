import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createDesignation, designationInput, listDesignations } from "@/server/modules/hr/employees";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listDesignations(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/designations", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createDesignation(ctx, orgId, companyId, await body(req, designationInput)));
