import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createJob, jobInput, listJobs } from "@/server/modules/hr/recruiting";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listJobs(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/jobs", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createJob(ctx, orgId, companyId, await body(req, jobInput)));
