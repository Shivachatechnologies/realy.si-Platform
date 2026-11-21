import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getJob, jobPatch, updateJob } from "@/server/modules/hr/recruiting";

type P = { orgId: string; companyId: string; id: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, id }) => getJob(ctx, orgId, companyId, id));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/jobs/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateJob(ctx, orgId, companyId, id, await body(req, jobPatch)));
