import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createStructure, listStructures, structureInput } from "@/server/modules/hr/payroll";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listStructures(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/payroll/structures", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createStructure(ctx, orgId, companyId, await body(req, structureInput)));
